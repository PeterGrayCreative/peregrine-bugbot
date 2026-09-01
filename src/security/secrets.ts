const TOKEN_PATTERNS = [
  /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/i,
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{16,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{16,}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{16,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bAIza[0-9A-Za-z_-]{30,}\b/,
];

const ASSIGNMENT_PATTERN =
  /\b(?:password|passwd|api[_-]?key|secret|token|connection[_-]?string)\b\s*[:=]\s*["']?([^\s"',}]{12,})/gi;
const SAFE_ASSIGNMENT_VALUES = /^(?:redacted|placeholder|example|\*+|\$\{|process\.env|env:|environment|vault|keychain)/i;

export function assertNoSecrets(value: unknown, context: string): void {
  for (const text of strings(value)) {
    if (TOKEN_PATTERNS.some((pattern) => pattern.test(text))) {
      throw new Error(`${context} contains a value matching a secret pattern; refusing to persist or publish it`);
    }
    ASSIGNMENT_PATTERN.lastIndex = 0;
    for (const match of text.matchAll(ASSIGNMENT_PATTERN)) {
      const candidate = match[1] ?? "";
      if (!SAFE_ASSIGNMENT_VALUES.test(candidate) && /[A-Za-z]/.test(candidate) && /\d/.test(candidate)) {
        throw new Error(`${context} contains a credential-like assignment; refusing to persist or publish it`);
      }
    }
  }
}

export function safeDiagnostic(value: string, maxLength = 2000): string {
  try {
    assertNoSecrets(value, "provider diagnostic");
    return value.slice(0, maxLength);
  } catch {
    return "provider diagnostic omitted because it matched a secret pattern";
  }
}

function* strings(value: unknown): Generator<string> {
  if (typeof value === "string") {
    yield value;
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) yield* strings(item);
    return;
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value as Record<string, unknown>)) yield* strings(item);
  }
}
