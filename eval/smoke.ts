import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gradeRuns } from "./grade.js";
import { buildReport } from "./report.js";
import { runMatrix } from "./run-matrix.js";

const smokeRoot = mkdtempSync(join(tmpdir(), "peregrine-eval-smoke-"));
try {
  const runsDir = await runMatrix("eval/matrix.smoke.json", smokeRoot);
  process.env.JUDGE = "exact";
  await gradeRuns(runsDir);
  const stats = await buildReport(runsDir);
  const mock = stats.find((item) => item.config === "mock");
  if (!mock || mock.recallMean !== 1 || mock.fpPerCaseMean !== 0) {
    throw new Error(`mock benchmark regression: ${JSON.stringify(mock)}`);
  }
  console.log("mock benchmark OK: recall 100%, 0 FP");
} finally {
  rmSync(smokeRoot, { recursive: true, force: true });
}
