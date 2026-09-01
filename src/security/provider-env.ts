const SENSITIVE_NAME = /(?:TOKEN|SECRET|PASSWORD|PASSWD|API[_-]?KEY|ACCESS[_-]?KEY|PRIVATE[_-]?KEY|CREDENTIAL|CONNECTION[_-]?STRING)/i;

const PROVIDER_KEYS: Record<"claude" | "codex", Set<string>> = {
  claude: new Set(["ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN"]),
  codex: new Set(["OPENAI_API_KEY"]),
};

/** Keep normal process context but remove unrelated credentials from model subprocesses. */
export function providerEnvironment(provider: "claude" | "codex"): Record<string, string> {
  const allowedSecrets = PROVIDER_KEYS[provider];
  return filteredEnvironment(allowedSecrets);
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
