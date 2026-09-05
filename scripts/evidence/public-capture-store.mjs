import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, existsSync, lstatSync } from "node:fs";
import { join } from "node:path";

export const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

function regularRead(path) {
  if (!lstatSync(path).isFile() || lstatSync(path).isSymbolicLink()) throw new Error("capture must be a regular file");
  return readFileSync(path);
}

function immutableWrite(path, bytes) {
  if (existsSync(path)) {
    if (!regularRead(path).equals(Buffer.from(bytes))) throw new Error("immutable capture conflict");
  } else writeFileSync(path, bytes, { flag: "wx" });
}

/** Store raw public GitHub bodies, with one immutable receipt per exact request.
 * The caller owns the designated evidence directory; no source checkout is written.
 */
export function capture(store, endpoint, parameters = {}, transport = githubGet) {
  if (!/^(repos\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_./-]+)?|search\/issues)$/.test(endpoint) || endpoint.includes("..")) {
    throw new Error("unsupported public evidence endpoint");
  }
  const request = { host: "api.github.com", method: "GET", endpoint,
    parameters: Object.fromEntries(Object.entries(parameters).sort(([a], [b]) => a.localeCompare(b))) };
  const key = digest(JSON.stringify(request));
  for (const directory of [store, join(store, "objects"), join(store, "requests")]) {
    mkdirSync(directory, { recursive: true });
    if (lstatSync(directory).isSymbolicLink()) throw new Error("capture directory cannot be a symlink");
  }
  const receiptPath = join(store, "requests", `${key}.json`);
  if (existsSync(receiptPath)) {
    const receipt = JSON.parse(regularRead(receiptPath));
    if (JSON.stringify(receipt.request) !== JSON.stringify(request) || !/^[a-f0-9]{64}$/.test(receipt.sha256)) throw new Error("invalid capture receipt");
    const bytes = regularRead(join(store, "objects", `${receipt.sha256}.json`));
    if (digest(bytes) !== receipt.sha256 || bytes.length !== receipt.bytes) throw new Error("capture hash mismatch");
    return { receipt, value: JSON.parse(bytes) };
  }
  const bytes = Buffer.from(transport(endpoint, request.parameters));
  const value = JSON.parse(bytes);
  const receipt = { schemaVersion: 1, request, retrievedAt: new Date().toISOString(),
    sourceUrl: `https://api.github.com/${endpoint}?${new URLSearchParams(request.parameters)}`,
    sha256: digest(bytes), bytes: bytes.length };
  immutableWrite(join(store, "objects", `${receipt.sha256}.json`), bytes);
  immutableWrite(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  return { receipt, value };
}

export function capturePages(store, endpoint, parameters = {}, transport = githubGet, maxPages = 100) {
  const pages = [];
  for (let page = 1; page <= maxPages; page++) {
    const result = capture(store, endpoint, { ...parameters, per_page: 100, page }, transport);
    const items = endpoint === "search/issues" ? result.value.items : result.value;
    if (!Array.isArray(items)) throw new Error("expected paginated array");
    if (result.value.incomplete_results || (endpoint === "search/issues" && result.value.total_count > 1000)) {
      throw new Error("search is incomplete; subdivide the registered date window");
    }
    pages.push(result);
    if (items.length < 100) return pages;
  }
  throw new Error("pagination ceiling reached; captured pages retained for resume");
}

function githubGet(endpoint, parameters) {
  return execFileSync("gh", ["api", "--hostname", "github.com", "--method", "GET", endpoint,
    "-H", "Accept: application/vnd.github+json", "-H", "X-GitHub-Api-Version: 2022-11-28",
    ...Object.entries(parameters).flatMap(([key, value]) => ["-f", `${key}=${value}`])],
  { maxBuffer: 32 * 1024 * 1024, timeout: 120_000 });
}
