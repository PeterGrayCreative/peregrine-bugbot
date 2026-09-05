import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { digest } from "./public-capture-store.mjs";

// This freezes attempted candidate slots, not admissions or truth judgments.
const root = resolve("docs/validation/artifacts/2026-09-05-r2-candidate-inventory");
const read = (path) => JSON.parse(readFileSync(join(root, path)));
const sources = ["random-sample-v1.json", "main-review-candidates-v1.json", "targeted-discovery-v2.json",
  "screening/main-review-threads.md", "screening/alpha-post-merge.md",
  "screening/alpha-post-merge-supplement.md", "screening/beta-review-threads.md",
  "screening/beta-review-threads-supplement.md"];
const candidates = [...read(sources[0]).candidates, ...read(sources[1]).candidates];
const frames = read("targeted-discovery-v2.json").frames;
const selections = [
  ["review-beta", "review-thread-lead", {
    "microsoft/vscode": [106448, 85326, 98988, 113285, 35956],
    "vercel/next.js": [7696, 7704, 13333, 16650, 14746, 15231, 17749, 14848, 9872, 16126, 20428, 7363, 9157, 8646, 10018, 10525],
    "nestjs/nest": [383, 2735, 5710, 814],
  }],
  ["post-merge-alpha", "post-merge-lead", {
    "microsoft/vscode": [75617, 83490, 91709, 99825, 100364, 112124],
    "vercel/next.js": [1798, 7889, 8045, 15916, 3755, 8517],
    "sequelize/sequelize": [7771, 10123, 10688],
    "webpack/webpack": [8293, 8829, 11243, 11553, 11707, 9706, 10966],
    "axios/axios": [2396],
    "ReactiveX/rxjs": [3165, 4751],
  }],
];
for (const [prefix, stratum, repositories] of selections) {
  let index = 0;
  for (const [repository, numbers] of Object.entries(repositories)) {
    const frame = frames.find((item) => item.repository === repository && item.stratum === stratum);
    for (const number of numbers) {
      const lead = frame?.leads.find((item) => item.number === number);
      if (!lead) throw new Error(`selected lead absent from authenticated frame: ${repository}#${number}`);
      candidates.push({ candidateId: `r2-${prefix}-${String(++index).padStart(3, "0")}`,
        repository, family: frame.family, number, sourceUrl: lead.url,
        sourceStratum: stratum, status: "screened-awaiting-reconstruction",
        truthStatus: "unknown", partition: "unassigned", duplicateFamily: "unassessed" });
    }
  }
  if (index !== 25) throw new Error(`${prefix} must preserve exactly 25 attempted slots`);
}
if (candidates.length !== 100 || new Set(candidates.map((item) => item.candidateId)).size !== 100 ||
  new Set(candidates.map((item) => item.sourceUrl)).size !== 100) throw new Error("inventory count or duplicate source mismatch");
const output = `${JSON.stringify({ schemaVersion: 1, evidenceClass: "historical-candidate",
  candidateSlots: 100, admittedCases: 0,
  limitation: "A bounded purposive shortlist plus 25 within-frame random PRs, not 100 valid defects. Discovery and screening inspected additional leads; all screening losses remain in source reports. Known duplicate, weak, after-window and ambiguous leads retain their slots. No automatic replacement or partition admission.",
  sourceManifests: sources.map((path) => ({ path, sha256: digest(readFileSync(join(root, path))) })),
  screeningRestrictions: [
    { repository: "webpack/webpack", number: 8829, status: "duplicate", duplicateFamily: "r1-webpack-8233", independentCredit: false },
    { repository: "ReactiveX/rxjs", number: 3165, status: "deferred", reason: "No fixing identity; potential build/performance attribution remains unresolved." },
    ...[106448, 113285].map((number) => ({ repository: "microsoft/vscode", number, status: "strict-window-ineligible-until-recovered", reason: "Relevant review or edit extends beyond 2020; recover in-window original before admission." })),
    { repository: "vercel/next.js", number: 20428, status: "strict-window-ineligible-until-recovered", reason: "Relevant review extends into 2021." },
  ], candidates }, null, 2)}\n`;
const target = join(root, "candidate-inventory-v1.json");
if (existsSync(target)) {
  if (readFileSync(target, "utf8") !== output) throw new Error("immutable inventory conflict");
} else writeFileSync(target, output, { flag: "wx" });
console.log("100 attempted candidate slots; 0 admitted cases; no partition assigned");
