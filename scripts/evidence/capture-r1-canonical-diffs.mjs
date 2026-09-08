import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDir, "../..");
const evidenceRoot = process.env.R1_EVIDENCE_ROOT
  ? resolve(process.env.R1_EVIDENCE_ROOT)
  : resolve(repositoryRoot, "docs/validation/artifacts/2026-09-04-r1-historical-reconstructions");
const sourceArgument = process.argv.indexOf("--source-root");
const sourceRoot = sourceArgument >= 0 && process.argv[sourceArgument + 1]
  ? resolve(process.argv[sourceArgument + 1])
  : process.env.R1_SOURCE_ROOT
    ? resolve(process.env.R1_SOURCE_ROOT)
    : "/private/tmp/peregrine-r1-sources";
const outputRoot = resolve(evidenceRoot, "curation/versions/r1-case-evidence-v3/diffs");
const cases = [
  { caseId: "r1-vscode-73801", repository: "vscode", base: "0cfb9ad1c3a4ea5983c8dbb458ed14f7581a6846", head: "b239497ecacac5e5c945791530251f1ee897b22b" },
  { caseId: "r1-typescript-37467", repository: "typescript", base: "933c2949236f38e1255a0aa4564246a3fef1518c", head: "6cbbdbcc4c22f7dd82b023059ca8230a927707e7" },
  { caseId: "r1-karma-2846", repository: "karma", base: "e79463b94ff6d3ad87526b3c68b38b90e924ea42", head: "eab78ff696f3de8ae226f930e08b93d20ffbdb66" },
  { caseId: "r1-karma-2714", repository: "karma", base: "2a847c250bb62134d87f5230d97be8483d4a13cf", head: "2789bf57abd977def5caf22609eef74acbad292e" },
  { caseId: "r1-webpack-8233", repository: "webpack", base: "2228daff027113a10790c75f2901c0b804d60a25", head: "dcd38348e5a74e250a6dbfa22e743fc7da0964ff" },
];
const fixedArguments = [
  "-c", "core.quotePath=true", "-c", "color.ui=false", "-c", "diff.renames=false",
  "diff", "--binary", "--full-index", "--no-ext-diff", "--no-textconv", "--no-renames",
  "--no-color", "--diff-algorithm=myers", "--src-prefix=a/", "--dst-prefix=b/", "--unified=3",
];
const environment = { ...process.env, LC_ALL: "C", LANG: "C" };
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const runGit = (repository, args) => {
  const result = spawnSync("git", args, { cwd: resolve(sourceRoot, repository), env: environment, encoding: null, maxBuffer: 128 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(result.stderr?.toString("utf8") || `git exited ${result.status}`);
  return result.stdout;
};

const gitVersion = runGit(cases[0].repository, ["--version"]).toString("utf8").trim();
for (const item of cases) {
  const args = [...fixedArguments, item.base, item.head, "--"];
  const bytes = runGit(item.repository, args);
  const path = resolve(outputRoot, `${item.caseId}.diff`);
  if (existsSync(path)) {
    if (!readFileSync(path).equals(bytes)) throw new Error(`refusing to overwrite drifted canonical diff: ${item.caseId}`);
  } else {
    writeFileSync(path, bytes);
  }
  console.log(`${item.caseId}\t${bytes.byteLength}\t${sha256(bytes)}\t${gitVersion}`);
}
