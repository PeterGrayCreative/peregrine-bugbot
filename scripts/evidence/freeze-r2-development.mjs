import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { digest } from "./public-capture-store.mjs";

const root = resolve("docs/validation/artifacts/2026-09-05-r2-candidate-inventory");
const reports = ["bull-development.md", "alpha-development.md", "beta-development.md",
  "independent-development-check.md", "independent-development-check-remaining.md"];
const paths = ["development-exposure-v1.json", ...reports.map((file) => `reconstructions/${file}`),
  "reconstruction-sources/README.md"];
function collect(relative) {
  for (const entry of readdirSync(join(root, relative), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = `${relative}/${entry.name}`;
    if (entry.isSymbolicLink()) throw new Error(`unexpected source symlink: ${path}`);
    if (entry.isDirectory()) collect(path);
    else if (entry.isFile()) paths.push(path);
    else throw new Error(`unexpected source entry: ${path}`);
  }
}
for (const source of ["bull", "alpha", "beta"]) collect(`reconstruction-sources/${source}`);
const files = paths.sort().map((path) => {
  const bytes = readFileSync(join(root, path));
  return { path, bytes: bytes.length, sha256: digest(bytes) };
});
const output = `${JSON.stringify({ schemaVersion: 1, evidenceClass: "exposed-historical-development-reconstruction",
  reconstructedOpportunities: 6, admittedCases: 0, runtimeReproductions: 0, humanConfirmations: 0,
  limitation: "Static source reconstruction plus independent AI checks, not human admission, complete truth or self-contained replay. Filtered source clones remain outside this archive. Independent check corrections supersede broader primary claims without overwriting them.", files }, null, 2)}\n`;
const target = join(root, "development-reconstruction-bundle-v1.json");
if (existsSync(target)) {
  if (readFileSync(target, "utf8") !== output) throw new Error("immutable reconstruction bundle conflict");
} else writeFileSync(target, output, { flag: "wx" });
console.log(JSON.stringify({ boundFiles: files.length, sha256: digest(output), reconstructed: 6, admitted: 0 }));
