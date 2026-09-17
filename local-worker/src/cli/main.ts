import { WorkerConfigError } from "../config/env.js";
import { loadWorkerEnv } from "../config/load-env.js";
import { createWorkerClient, SupabaseWorkerStore } from "../db/worker-store.js";
import { StructuredLogger } from "../logging/logger.js";
import { WorkerRunner } from "../queue/runner.js";
import { buildStatusReport } from "../status/status.js";

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
  const store = new SupabaseWorkerStore(createWorkerClient(env));
  // Phase 6 installs deterministic mock handlers here. An empty registry is deliberate: Phase 5
  // may recover leases and report health, but it never claims a stage it cannot finish safely.
  const runner = new WorkerRunner({ env, store, handlers: {}, logger });

  try {
    if (command === "status") {
      const report = buildStatusReport(
        await store.status(env.WORKER_ID),
        env,
        runner.supportedStages,
      );
      logger.info("worker.status", { report });
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
        await withShutdownDeadline(
          runner.run(shutdown.signal),
          shutdown.signal,
          env.WORKER_SHUTDOWN_TIMEOUT_MS,
        );
      }
      return 0;
    } finally {
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
