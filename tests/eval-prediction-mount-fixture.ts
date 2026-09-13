import type { TestContext } from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { syntheticRegistration } from "./eval-prediction-fixture.js";
import { sha } from "../eval/prediction-contract.js";
import { bindPredictionRegistration } from "../eval/prediction-plan.js";
import { bindPredictionMounts, type PredictionMountEntry } from "../eval/prediction-mounts.js";

export function predictionMountFixture(t: TestContext, large = false) {
  const root = mkdtempSync(join(tmpdir(), "prediction-preparation-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const registration = syntheticRegistration(), registrationBytes = JSON.stringify(registration);
  const file = (path: string, content: string, mode: PredictionMountEntry["mode"] = "100644"): PredictionMountEntry => ({ path, mode, oid: "a".repeat(40), bytes: Buffer.byteLength(content), sha256: sha(content) });
  const diff = "diff --git a/index.ts b/index.ts\n--- a/index.ts\n+++ b/index.ts\n@@ -1 +1 @@\n-export const value = 0;\n+export const value = 1;\n";
  const cases = registration.cases.filter(c => c.included).map((c, index) => {
    const reviewerId = `item-${index.toString(16).padStart(16, "0")}`;
    const directory = join(root, reviewerId); mkdirSync(join(directory, "head"), { recursive: true });
    const content = "export const value = 1;\n", license = "MIT synthetic fixture\n", big = "x".repeat(1_100_000);
    writeFileSync(join(directory, "head/index.ts"), content, { mode: 0o644 });
    writeFileSync(join(directory, "head/LICENSE"), license, { mode: 0o644 });
    symlinkSync("index.ts", join(directory, "head/link"));
    if (large) writeFileSync(join(directory, "head/large.txt"), big, { mode: 0o644 });
    writeFileSync(join(directory, "review.diff"), diff, { mode: 0o644 });
    const head = [file("LICENSE", license), file("index.ts", content), file("link", "index.ts", "120000"), ...(large ? [file("large.txt", big)] : [])];
    const base = head.map(e => e.path === "index.ts" ? file("index.ts", "export const value = 0;\n") : e);
    const allowedFiles: PredictionMountEntry[] = [...head.map(e => ({ ...e, path: `head/${e.path}` })), { path: "review.diff", mode: "100644" as const, bytes: Buffer.byteLength(diff), sha256: sha(diff) }].sort((a,b) => a.path.localeCompare(b.path, "en"));
    return { caseId: c.caseId, reviewerId, base: "a".repeat(40), head: "b".repeat(40), baseTree: "c".repeat(40), headTree: "d".repeat(40), context: [], inventories: { base, head }, allowedFiles,
      diff: { bytes: Buffer.byteLength(diff), sha256: sha(diff) }, inputDigest: sha(`${JSON.stringify(allowedFiles, null, 2)}\n`) };
  });
  const manifest = { registrationSha256: sha(registrationBytes), mountVersion: 2, contextPolicy: "none-for-every-case", cases,
    attemptBindings: registration.schedule.map(a => { const c = cases.find(c => c.caseId === a.caseId)!; return { id: a.id, reviewerId: c.reviewerId, inputDigest: c.inputDigest }; }) };
  const manifestBytes = JSON.stringify(manifest);
  const conditionsBytes = JSON.stringify(registration.cases.filter(c => c.included).map(c => ({ caseId: c.caseId, contract: c.contract, conditions: [{ id: "bounded-condition", text: c.contract }] })));
  const authority = { registrationBytes, registrationSha256: sha(registrationBytes), manifestBytes, manifestSha256: sha(manifestBytes), conditionsBytes, conditionsSha256: sha(conditionsBytes) };
  const mounts = bindPredictionMounts(manifestBytes, authority.manifestSha256, bindPredictionRegistration(registrationBytes, authority.registrationSha256));
  return { root, authority, mounts, manifest, firstRoot: join(root, cases[0]!.reviewerId), first: mounts[0]! };
}
