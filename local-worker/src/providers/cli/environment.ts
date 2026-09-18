/**
 * The environment a subscription CLI child process receives.
 *
 * The worker loads `.env.local` into its own `process.env`, so that object holds the Supabase
 * service-role key, the revalidation secret, and any optional API keys. A child must never inherit
 * it. This module builds a fresh environment from an explicit allowlist instead: what Windows and
 * the CLI need to start, find their own sign-in under the user profile, and reach the network
 * through a configured proxy. Nothing else crosses.
 *
 * API keys are excluded by construction rather than by a denylist. `ANTHROPIC_API_KEY`,
 * `OPENAI_API_KEY`, and `CODEX_API_KEY` would each switch the CLI from the subscription sign-in to
 * per-request API billing, which subscription modes must never do (plan section 10.3/10.4).
 */

export type CliName = "claude" | "codex";

/** Operating-system, profile, locale, and proxy variables. Compared case-insensitively. */
const BASE_VARIABLES = [
  "PATH",
  "PATHEXT",
  "SYSTEMROOT",
  "SYSTEMDRIVE",
  "WINDIR",
  "COMSPEC",
  "OS",
  "PROCESSOR_ARCHITECTURE",
  "NUMBER_OF_PROCESSORS",
  "TEMP",
  "TMP",
  "TMPDIR",
  "HOME",
  "USERPROFILE",
  "HOMEDRIVE",
  "HOMEPATH",
  "APPDATA",
  "LOCALAPPDATA",
  "PROGRAMDATA",
  "PROGRAMFILES",
  "PROGRAMFILES(X86)",
  "COMMONPROGRAMFILES",
  "USERNAME",
  "USERDOMAIN",
  "COMPUTERNAME",
  "LOGNAME",
  "USER",
  "SHELL",
  "LANG",
  "LANGUAGE",
  "LC_ALL",
  "LC_CTYPE",
  "TZ",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "XDG_CACHE_HOME",
  "XDG_STATE_HOME",
  "HTTPS_PROXY",
  "HTTP_PROXY",
  "NO_PROXY",
  "ALL_PROXY",
  "NODE_EXTRA_CA_CERTS",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
] as const;

/**
 * Variables that locate a CLI's own sign-in. `CLAUDE_CODE_OAUTH_TOKEN` is the long-lived
 * subscription token from `claude setup-token`, not an API key; it is the documented way to run
 * Claude Code headless on a subscription.
 */
const PROVIDER_VARIABLES: Readonly<Record<CliName, readonly string[]>> = {
  claude: ["CLAUDE_CONFIG_DIR", "CLAUDE_CODE_OAUTH_TOKEN"],
  codex: ["CODEX_HOME"],
};

/** Set on every child: no colour codes, no update checks, no telemetry during a worker run. */
const FIXED_VARIABLES: Readonly<Record<CliName, Readonly<Record<string, string>>>> = {
  claude: {
    NO_COLOR: "1",
    CI: "1",
    DISABLE_AUTOUPDATER: "1",
    DISABLE_TELEMETRY: "1",
    DISABLE_ERROR_REPORTING: "1",
  },
  codex: { NO_COLOR: "1", CI: "1" },
};

export function cliEnvironment(
  cli: CliName,
  source: Readonly<Record<string, string | undefined>> = process.env,
): Record<string, string> {
  const allowed = new Set<string>([...BASE_VARIABLES, ...PROVIDER_VARIABLES[cli]]);
  const environment: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined || value === "") continue;
    // Windows variable names are case-insensitive and `process.env` preserves the casing Windows
    // reports (`Path`, `SystemRoot`). Keep that casing; compare in upper case.
    if (allowed.has(key.toUpperCase())) environment[key] = value;
  }
  return { ...environment, ...FIXED_VARIABLES[cli] };
}
