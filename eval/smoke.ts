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
  if (!mock || mock.benchmarkKind !== "structural-only" || mock.completedRuns !== mock.expectedRuns ||
    mock.failedRuns !== 0 || mock.missingRuns !== 0 ||
    mock.structuralExpectedMarkers !== mock.structuralMatchedMarkers ||
    mock.structuralUnexpectedFindings !== 0 || mock.recallMean !== null ||
    mock.costPerCaseMean !== null) {
    throw new Error(`mock structural smoke regression: ${JSON.stringify(mock)}`);
  }
  console.log(
    `mock structural smoke OK: ${mock.completedRuns}/${mock.expectedRuns} attempts; ` +
    `${mock.structuralMatchedMarkers}/${mock.structuralExpectedMarkers} expected markers`,
  );
} finally {
  rmSync(smokeRoot, { recursive: true, force: true });
}
