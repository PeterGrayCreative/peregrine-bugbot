const SENSITIVE_NAME = /(?:TOKEN|SECRET|PASSWORD|PASSWD|API[_-]?KEY|ACCESS[_-]?KEY|PRIVATE[_-]?KEY|CREDENTIAL|CONNECTION[_-]?STRING)/i;

const PROVIDER_KEYS: Record<"claude" | "codex", Set<string>> = {
  claude: new Set(["ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN"]),
  codex: new Set(["OPENAI_API_KEY"]),
};

const ISOLATED_PROVIDER_KEYS: Record<"claude" | "codex", Set<string>> = {
  // Claude --bare explicitly disables OAuth and keychain reads.
  claude: new Set(["ANTHROPIC_API_KEY"]),
  codex: new Set(["OPENAI_API_KEY"]),
};

/** Keep normal process context but remove unrelated credentials from model subprocesses. */
export function providerEnvironment(provider: "claude" | "codex"): Record<string, string> {
  const allowedSecrets = PROVIDER_KEYS[provider];
  return filteredEnvironment(allowedSecrets);
}

/**
 * Minimal environment for provider processes launched by the eval harness.
 * Authentication may flow only through the selected provider's explicit
 * environment key. Ambient Git/SSH agents and user-level CLI/Git config are
 * intentionally unavailable inside the attempt-specific home directory.
 */
export function isolatedProviderEnvironment(
  provider: "claude" | "codex",
  home: string,
): Record<string, string> {
  const environment: Record<string, string> = {
    PATH: process.env.PATH ?? "",
    HOME: home,
    TMPDIR: `${home}/tmp`,
    XDG_CONFIG_HOME: `${home}/xdg-config`,
    XDG_CACHE_HOME: `${home}/xdg-cache`,
    XDG_DATA_HOME: `${home}/xdg-data`,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_TERMINAL_PROMPT: "0",
  };
  for (const name of ["LANG", "LC_ALL", "SSL_CERT_FILE", "SSL_CERT_DIR", "NODE_EXTRA_CA_CERTS"]) {
    const value = process.env[name];
    if (value !== undefined) environment[name] = value;
  }
  for (const name of ISOLATED_PROVIDER_KEYS[provider]) {
    const value = process.env[name];
    if (value !== undefined) environment[name] = value;
  }
  return environment;
}

/** Environment for deterministic helper processes that need no credentials. */
export function nonSensitiveEnvironment(): Record<string, string> {
  return filteredEnvironment(new Set());
}

function filteredEnvironment(allowedSecrets: Set<string>): Record<string, string> {
  const environment: Record<string, string> = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if (SENSITIVE_NAME.test(name) && !allowedSecrets.has(name)) continue;
    environment[name] = value;
  }
  return environment;
}
