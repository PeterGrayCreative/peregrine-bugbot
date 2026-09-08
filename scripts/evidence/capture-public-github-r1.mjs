import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDir, "../..");
const outputDir = resolve(
  repositoryRoot,
  "docs/validation/artifacts/2026-09-04-r1-historical-reconstructions/raw",
);

const requests = [
  ["vscode-pr-73801", "repos/microsoft/vscode/pulls/73801"],
  ["vscode-pr-73801-comments", "repos/microsoft/vscode/pulls/73801/comments"],
  ["vscode-pr-73801-reviews", "repos/microsoft/vscode/pulls/73801/reviews"],
  ["vscode-pr-73801-commits", "repos/microsoft/vscode/pulls/73801/commits"],
  ["typescript-pr-37467", "repos/microsoft/TypeScript/pulls/37467"],
  ["typescript-pr-37467-comments", "repos/microsoft/TypeScript/pulls/37467/comments"],
  ["typescript-pr-37467-reviews", "repos/microsoft/TypeScript/pulls/37467/reviews"],
  ["typescript-issue-38507", "repos/microsoft/TypeScript/issues/38507"],
  ["typescript-pr-38599", "repos/microsoft/TypeScript/pulls/38599"],
  ["karma-pr-2846", "repos/karma-runner/karma/pulls/2846"],
  ["karma-pr-2846-comments", "repos/karma-runner/karma/pulls/2846/comments"],
  ["karma-pr-2846-reviews", "repos/karma-runner/karma/pulls/2846/reviews"],
  ["karma-pr-2714", "repos/karma-runner/karma/pulls/2714"],
  ["karma-pr-2714-comments", "repos/karma-runner/karma/pulls/2714/comments"],
  ["karma-pr-2714-reviews", "repos/karma-runner/karma/pulls/2714/reviews"],
  ["webpack-pr-8233", "repos/webpack/webpack/pulls/8233"],
  ["webpack-pr-8233-comments", "repos/webpack/webpack/pulls/8233/comments"],
  ["webpack-pr-8233-reviews", "repos/webpack/webpack/pulls/8233/reviews"],
  ["webpack-issue-8829", "repos/webpack/webpack/issues/8829"],
  ["webpack-pr-8844", "repos/webpack/webpack/pulls/8844"],
];

mkdirSync(outputDir, { recursive: true });

const capturedAt = new Date().toISOString();
const captures = requests.map(([name, endpoint]) => {
  const body = execFileSync(
    "gh",
    ["api", "-X", "GET", endpoint, "-f", "per_page=100"],
    { maxBuffer: 16 * 1024 * 1024 },
  );
  const parsed = JSON.parse(body.toString("utf8"));
  if (Array.isArray(parsed) && parsed.length === 100) {
    throw new Error(`${endpoint} reached the single-page limit; add explicit pagination`);
  }

  const file = `${name}.json`;
  writeFileSync(resolve(outputDir, file), body, { flag: "wx" });
  return {
    request: {
      method: "GET",
      endpoint,
      parameters: { per_page: 100 },
    },
    file,
    bytes: body.byteLength,
    sha256: createHash("sha256").update(body).digest("hex"),
  };
});

const manifest = {
  schemaVersion: 1,
  capturedAt,
  transport: "gh api",
  pagination: "single page with per_page=100; capture rejects exactly 100 records",
  captures,
};
writeFileSync(
  resolve(outputDir, "capture-manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
  { flag: "wx" },
);

console.log(`Captured ${captures.length} public responses in ${basename(outputDir)}`);
