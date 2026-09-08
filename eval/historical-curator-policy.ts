import { parseCuratorPolicy, type CuratorPolicy } from "./case-curation.js";

const SHA256 = /^[a-f0-9]{64}$/;

export interface SoleHumanHistoricalCuratorPolicy {
  schemaVersion: 2;
  policyId: "sole-human-historical-v1";
  trustRoot: "accountable-human-review";
  reviewMode: "sole-human-v1";
  minimumHumanDecisions: 1;
  registeredHumanIdentitySha256: string;
  aiPreparationCanSatisfyHumanGate: false;
}

export type HistoricalCuratorPolicy = CuratorPolicy | SoleHumanHistoricalCuratorPolicy;

export function parseHistoricalCuratorPolicy(
  value: unknown,
  label = "historical curator policy",
): HistoricalCuratorPolicy {
  if (value && typeof value === "object" && !Array.isArray(value) &&
      (value as Record<string, unknown>).schemaVersion === 1) {
    return parseCuratorPolicy(value, label);
  }
  const root = strictObject(value, label, [
    "schemaVersion", "policyId", "trustRoot", "reviewMode", "minimumHumanDecisions",
    "registeredHumanIdentitySha256", "aiPreparationCanSatisfyHumanGate",
  ]);
  if (root.schemaVersion !== 2 || root.policyId !== "sole-human-historical-v1" ||
      root.trustRoot !== "accountable-human-review" || root.reviewMode !== "sole-human-v1") {
    throw new Error(`${label} must use the sole-human-historical-v1 trust root`);
  }
  if (root.minimumHumanDecisions !== 1) {
    throw new Error(`${label}.minimumHumanDecisions must be 1`);
  }
  if (root.aiPreparationCanSatisfyHumanGate !== false) {
    throw new Error(`${label}.aiPreparationCanSatisfyHumanGate must be false`);
  }
  if (typeof root.registeredHumanIdentitySha256 !== "string" ||
      !SHA256.test(root.registeredHumanIdentitySha256)) {
    throw new Error(`${label}.registeredHumanIdentitySha256 must be a lowercase SHA-256`);
  }
  return {
    schemaVersion: 2,
    policyId: "sole-human-historical-v1",
    trustRoot: "accountable-human-review",
    reviewMode: "sole-human-v1",
    minimumHumanDecisions: 1,
    registeredHumanIdentitySha256: root.registeredHumanIdentitySha256,
    aiPreparationCanSatisfyHumanGate: false,
  };
}

function strictObject(
  value: unknown,
  label: string,
  keys: readonly string[],
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  const root = value as Record<string, unknown>;
  const unexpected = Object.keys(root).filter((key) => !keys.includes(key));
  const missing = keys.filter((key) => !Object.hasOwn(root, key));
  if (unexpected.length > 0 || missing.length > 0) {
    throw new Error(`${label} has an invalid shape`);
  }
  return root;
}
