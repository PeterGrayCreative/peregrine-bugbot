import { digest, freeze } from "./prediction-contract.js";

const RULES = [
  { id: "explicit-arm", pattern: /\barm\s*(?:[-:=]\s*)?[abcd]\b/i },
  { id: "method-name", pattern: /\bperegrine\b/i },
  { id: "expected-winner", pattern: /\b(?:winner|winning\s+arm|expected\s+winner)\b|\b[abcd]\s+(?:to\s+win|(?:will|should|must)\s+win|wins?)\b/i },
  { id: "method-assignment", pattern: /\b(?:baseline|candidate)\s+(?:arm|reviewer|method)\b|\b(?:minimal|generic)\s+(?:baseline|reviewer)\b/i },
] as const;

/** Deterministic proposal for external screening review, not proof of blinding.
 * It contains locations and rule identifiers, not copied raw response text.
 * Raw evidence stays unchanged in the administrator's sealed run. There is no
 * automatic redaction or bypass: detected disclosures stop packet creation. */
export function screenPredictionDisclosure(value: unknown) {
  const matches: { path: string; rules: string[] }[] = [];
  function visit(item: unknown, path: string): void {
    if (typeof item === "string") {
      const rules = RULES.filter(rule => rule.pattern.test(item)).map(rule => rule.id);
      if (rules.length > 0) matches.push({ path, rules });
    } else if (Array.isArray(item)) item.forEach((child, index) => visit(child, `${path}[${index}]`));
    else if (item && typeof item === "object") Object.entries(item).sort(([a], [b]) => a.localeCompare(b)).forEach(([key, child]) => visit(child, `${path}.${key}`));
  }
  const inputSha256 = digest(value);
  visit(value, "$");
  const body = { kind: "prediction-disclosure-screen-v1", inputSha256, status: matches.length === 0 ? "no-listed-pattern-detected" : "blocked-detectable-disclosure", matches,
    freeTextBlindnessEstablished: false, reviewedRedactionEstablished: false };
  return freeze({ ...body, sha256: digest(body) });
}
