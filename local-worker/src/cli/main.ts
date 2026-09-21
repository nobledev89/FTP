import {
  requireApiProviderCredentials,
  WorkerConfigError,
  type ApiProvider,
} from "../config/env.js";
import { loadWorkerEnv } from "../config/load-env.js";
import { ArtifactStore } from "../db/artifact-store.js";
import { createWorkerClient, SupabaseWorkerStore } from "../db/worker-store.js";
import { StructuredLogger } from "../logging/logger.js";
import { createPipelineHandlers } from "../pipeline/handlers.js";
import { createApiAdapters } from "../providers/api/adapters.js";
import { createCliAdapters } from "../providers/cli/adapters.js";
import { CliCapabilityMonitor } from "../providers/cli/capabilities.js";
import { PublishingService } from "../publishing/publish.js";
import { CacheRevalidationClient } from "../publishing/revalidate.js";
import { WorkerRunner } from "../queue/runner.js";
import { buildStatusReport } from "../status/status.js";
import { VerificationService } from "../verification/verify.js";
import { SupabaseDiscoveryStore, TopicDiscoveryService } from "../discovery/service.js";
import { HeroReplacementService, SupabaseHeroReplacementStore } from "../reimage/service.js";

type Command = "once" | "start" | "status";

async function main(): Promise<number> {
  const command = parseCommand(process.argv.slice(2));
  if (!command) {
    process.stderr.write("Usage: worker <once|start|status>\n");
    return 2;
  }

  let env;
  try {
    env = loadWorkerEnv();
  } catch (error) {
    const logger = new StructuredLogger();
    logger.error("worker.configuration_invalid", {
      error:
        error instanceof WorkerConfigError
          ? { name: error.name, message: error.message, issues: error.issues }
          : error,
    });
    return 2;
  }

  const logger = new StructuredLogger({ worker_id: env.WORKER_ID });
  const client = createWorkerClient(env);
  const store = new SupabaseWorkerStore(client);
  const artifacts = new ArtifactStore(client);
  let apiProvidersInUse: readonly ApiProvider[];
  try {
    apiProvidersInUse = await store.apiProvidersInUse();
  } catch (error) {
    logger.error("worker.command_failed", { command, error });
    return 1;
  }
  try {
    requireApiProviderCredentials(env, apiProvidersInUse);
  } catch (error) {
    logger.error("worker.configuration_invalid", {
      error:
        error instanceof WorkerConfigError
          ? { name: error.name, message: error.message, issues: error.issues }
          : error,
    });
    return 2;
  }
  // The subscription CLIs receive an allowlisted environment built from this process's, never the
  // process environment itself, which holds the service-role key loaded from `.env.local`.
  const cli = createCliAdapters({
    claude: {
      bin: env.CLAUDE_BIN,
      ...(env.CLAUDE_MODEL ? { model: env.CLAUDE_MODEL } : {}),
    },
    codex: {
      bin: env.CODEX_BIN,
      ...(env.CODEX_MODEL ? { model: env.CODEX_MODEL } : {}),
      ...(env.CODEX_REASONING_EFFORT ? { reasoningEffort: env.CODEX_REASONING_EFFORT } : {}),
    },
    runtime: { timeoutMs: env.CLI_TIMEOUT_MS },
  });
  const capabilities = new CliCapabilityMonitor(cli.clis);
  const api = createApiAdapters({
    openai: {
      model: env.OPENAI_API_MODEL,
      ...(env.OPENAI_API_KEY ? { apiKey: env.OPENAI_API_KEY } : {}),
    },
    anthropic: {
      model: env.ANTHROPIC_API_MODEL,
      ...(env.ANTHROPIC_API_KEY ? { apiKey: env.ANTHROPIC_API_KEY } : {}),
    },
    gemini: {
      model: env.GEMINI_IMAGE_MODEL,
      ...(env.GEMINI_API_KEY ? { apiKey: env.GEMINI_API_KEY } : {}),
    },
    runtime: {
      timeoutMs: env.API_TIMEOUT_MS,
      maxResponseBytes: env.API_MAX_RESPONSE_BYTES,
    },
  });
  const revalidator = new CacheRevalidationClient({
    publicSiteUrl: env.PUBLIC_SITE_URL,
    secret: env.REVALIDATION_SECRET,
    timeoutMs: env.PUBLISH_VERIFY_TIMEOUT_MS,
  });
  const handlers = createPipelineHandlers({
    store: artifacts,
    publisher: new PublishingService(client, artifacts, revalidator, logger),
    verifier: new VerificationService(client, {
      publicSiteUrl: env.PUBLIC_SITE_URL,
      timeoutMs: env.PUBLISH_VERIFY_TIMEOUT_MS,
    }),
    cli,
    api,
    logger,
  });
  const runner = new WorkerRunner({
    env,
    store,
    handlers,
    logger,
    providerHealth: () => capabilities.health(),
    discovery: new TopicDiscoveryService(
      new SupabaseDiscoveryStore(client),
      cli.codex,
      env.WORKER_ID,
      logger,
    ),
    heroReplacements: new HeroReplacementService(
      new SupabaseHeroReplacementStore(client, env.WORKER_ID, revalidator, logger),
      env.WORKER_ID,
      {
        gemini: {
          settings: {
            model: env.GEMINI_IMAGE_MODEL,
            ...(env.GEMINI_API_KEY ? { apiKey: env.GEMINI_API_KEY } : {}),
          },
          runtime: {
            timeoutMs: env.API_TIMEOUT_MS,
            maxResponseBytes: env.API_MAX_RESPONSE_BYTES,
          },
        },
        codex: cli.codex,
      },
      logger,
    ),
  });

  try {
    // Probing never sends a prompt: version, supported options, and the CLI's own sign-in report.
    const probes = await capabilities.refresh();
    for (const probe of probes) {
      const detail = { mode: probe.mode, version: probe.version, account: probe.account };
      if (probe.ready) logger.info("provider.cli_ready", detail);
      else logger.warn("provider.cli_unavailable", { ...detail, problem: probe.problem });
    }

    if (command === "status") {
      const report = buildStatusReport(
        await store.status(env.WORKER_ID),
        env,
        runner.supportedStages,
      );
      logger.info("worker.status", { report, providers: capabilities.health() });
      return report.ok ? 0 : 3;
    }

    const shutdown = installShutdown(logger);
    try {
      if (command === "once") {
        const result = await withShutdownDeadline(
          runner.runOnce(shutdown.signal),
          shutdown.signal,
          env.WORKER_SHUTDOWN_TIMEOUT_MS,
        );
        logger.info("worker.once_finished", { result: result.state, job_id: result.claim?.jobId });
      } else {
        capabilities.start();
        await withShutdownDeadline(
          runner.run(shutdown.signal),
          shutdown.signal,
          env.WORKER_SHUTDOWN_TIMEOUT_MS,
        );
      }
      return 0;
    } finally {
      capabilities.stop();
      shutdown.dispose();
    }
  } catch (error) {
    logger.error("worker.command_failed", { command, error });
    return 1;
  }
}

function parseCommand(args: readonly string[]): Command | null {
  if (args.length !== 1) return null;
  const command = args[0];
  return command === "once" || command === "start" || command === "status" ? command : null;
}

function installShutdown(logger: StructuredLogger): {
  signal: AbortSignal;
  dispose(): void;
} {
  const controller = new AbortController();
  const onSignal = (signal: NodeJS.Signals) => {
    if (!controller.signal.aborted) {
      logger.warn("worker.shutdown_requested", { signal });
      controller.abort(new DOMException(`Received ${signal}`, "AbortError"));
    } else {
      logger.warn("worker.shutdown_already_in_progress", { signal });
    }
  };
  const onSigint = () => onSignal("SIGINT");
  const onSigterm = () => onSignal("SIGTERM");
  const onSighup = () => onSignal("SIGHUP");
  process.on("SIGINT", onSigint);
  process.on("SIGTERM", onSigterm);
  process.on("SIGHUP", onSighup);
  return {
    signal: controller.signal,
    dispose() {
      process.off("SIGINT", onSigint);
      process.off("SIGTERM", onSigterm);
      process.off("SIGHUP", onSighup);
    },
  };
}

async function withShutdownDeadline<T>(
  operation: Promise<T>,
  signal: AbortSignal,
  timeoutMs: number,
): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    signal.addEventListener(
      "abort",
      () => {
        timeout = setTimeout(
          () => reject(new Error(`Graceful shutdown exceeded ${timeoutMs}ms`)),
          timeoutMs,
        );
        timeout.unref();
      },
      { once: true },
    );
  });
  try {
    return await Promise.race([operation, deadline]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

process.exitCode = await main();
