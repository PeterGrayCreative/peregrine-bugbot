import { join } from "node:path";
import { assertNoSecrets } from "../src/security/secrets.js";
import { canonicalJson, canonicalJsonSha256, readExperimentJson, writeExclusiveJson } from "./experiment.js";
import {
  buildMethodologyContrasts,
  methodologyContrastsSha256,
  type MethodologyContrastArtifact,
  type BuildMethodologyContrastsInput,
} from "./methodology-contrasts.js";

export const METHODOLOGY_CONTRAST_FILE = "methodology-contrast.json";

/** Persist a contrast as a derived, append-only artifact. No provider calls occur here. */
export function writeMethodologyContrastArtifact(root: string, input: BuildMethodologyContrastsInput): MethodologyContrastArtifact {
  const artifact = buildMethodologyContrasts(input);
  assertNoSecrets(artifact, "methodology contrast");
  writeExclusiveJson(root, join(root, METHODOLOGY_CONTRAST_FILE), artifact);
  return artifact;
}

/**
 * Read and rederive a contrast from its authenticated source artifacts. The stored JSON
 * is never trusted for metrics: every field is rebuilt and compared byte-for-byte.
 */
export function readMethodologyContrastArtifact(root: string, input: {
  schedule: unknown;
  gradeSet: BuildMethodologyContrastsInput["gradeSet"];
  adjudication: BuildMethodologyContrastsInput["adjudication"];
  resourceSet: BuildMethodologyContrastsInput["resourceSet"];
  expectedContrastSha256: string;
}): MethodologyContrastArtifact {
  const raw = readExperimentJson(join(root, METHODOLOGY_CONTRAST_FILE)) as MethodologyContrastArtifact;
  const rebuilt = buildMethodologyContrasts({
    schedule: input.schedule,
    gradeSet: input.gradeSet,
    adjudication: input.adjudication,
    resourceSet: input.resourceSet,
  });
  if (!/^[a-f0-9]{64}$/.test(input.expectedContrastSha256) ||
      raw.contrastSha256 !== input.expectedContrastSha256 ||
      rebuilt.contrastSha256 !== input.expectedContrastSha256 ||
      canonicalJson(raw) !== canonicalJson(rebuilt)) {
    throw new Error("methodology contrast artifact digest mismatch");
  }
  // Recompute the body digest explicitly so a future reader cannot accidentally
  // compare only the outer object or accept a malformed digest field.
  const { contrastSha256, ...body } = raw;
  if (contrastSha256 !== methodologyContrastsSha256(body) ||
      contrastSha256 !== canonicalJsonSha256(body)) {
    throw new Error("methodology contrast artifact digest mismatch");
  }
  assertNoSecrets(raw, "methodology contrast");
  return rebuilt;
}
