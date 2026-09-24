import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

const OID = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
type Entry = { mode: string; type: string; oid: string; path: string };

export interface DevelopmentEndpointInput {
  sourceBareStore: string;
  baseCommit: string;
  baseTree: string;
  headCommit: string;
  headTree: string;
  retainedDiffPath: string;
  retainedDiffSha256: string;
  outputDirectory: string;
}

export interface DevelopmentEndpointResult {
  repository: string;
  sourceBaseCommit: string;
  sourceHeadCommit: string;
  baseCommit: string;
  headCommit: string;
  baseTree: string;
  headTree: string;
  diffSha256: string;
  sourceAncestry: "unestablished";
}

function git(args: string[], gitDir: string, cwd?: string): Buffer {
  return execFileSync("git", args, {
    cwd,
    env: {
      PATH: process.env.PATH,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_SYSTEM: "/dev/null",
      GIT_NO_REPLACE_OBJECTS: "1",
      GIT_OPTIONAL_LOCKS: "0",
      GIT_TERMINAL_PROMPT: "0",
      GIT_DIR: gitDir,
      GIT_TEMPLATE_DIR: "/dev/null",
    },
    encoding: "buffer",
    maxBuffer: 128 * 1024 * 1024,
  });
}

function oid(value: string, label: string): void {
  if (!OID.test(value)) throw new Error(`${label} must be a full SHA-1 object ID`);
}

function assertSafePath(path: string): void {
  if (!path || path.startsWith("/") || path.includes("\\") || path.split("/").some((part) => !part || part === "." || part === ".." || [".git", ".gitmodules"].includes(part.toLowerCase()))) {
    throw new Error("unsafe source tree path");
  }
}

function entries(store: string, tree: string): Entry[] {
  const raw = git(["ls-tree", "-r", "-z", tree], store);
  const result: Entry[] = [];
  for (const bytes of raw.subarray(0, raw.length - (raw.at(-1) === 0 ? 1 : 0)).toString("binary").split("\0")) {
    const record = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.from(bytes, "binary"));
    if (!record) continue;
    const match = /^(100644|100755|120000|160000) (blob|commit) ([0-9a-f]{40})\t(.+)$/.exec(record);
    if (!match) throw new Error("unsupported source tree entry");
    const [, mode, type, objectId, path] = match;
    assertSafePath(path!);
    if (mode === "160000" || type !== "blob") throw new Error("gitlinks are unsupported");
    result.push({ mode: mode!, type: type!, oid: objectId!, path: path! });
  }
  return result;
}

function assertStore(store: string): void {
  if (!existsSync(join(store, "HEAD")) || !existsSync(join(store, "objects"))) throw new Error("source is not a bare Git store");
  if (git(["rev-parse", "--is-bare-repository"], store).toString("utf8").trim() !== "true") throw new Error("source is not a bare Git store");
  for (const path of ["objects/info/alternates", "info/grafts", "objects/info/http-alternates", "shallow.lock"]) {
    if (existsSync(join(store, path))) throw new Error(`source store contains ${path}`);
  }
  const config = readFileSync(join(store, "config"), "utf8");
  if (/partialclone|promisor/i.test(config)) {
    throw new Error("source store contains a promisor configuration");
  }
  if (git(["for-each-ref", "--format=%(refname)", "refs/replace"], store).length) throw new Error("source store contains replace refs");
  git(["fsck", "--strict", "--no-reflogs", "--no-dangling"], store);
}

function blob(store: string, id: string): Buffer {
  return git(["cat-file", "blob", id], store);
}

function assertSymlinks(list: Entry[], store: string): void {
  const links = new Map<string, string>();
  const decode = new TextDecoder("utf-8", { fatal: true });
  for (const entry of list) {
    if (entry.mode !== "120000") continue;
    const target = decode.decode(blob(store, entry.oid));
    if (!target || target.includes("\0") || isAbsolute(target) || target.includes("\\")) throw new Error("unsafe symlink target");
    links.set(entry.path, target);
  }
  for (const [path, target] of links) {
    const resolved = path.split("/").slice(0, -1);
    const pending = target.split("/");
    let expansions = 0;
    let sawName = false;
    while (pending.length) {
      const part = pending.shift()!;
      if (!part || part === ".") continue;
      if (part === "..") {
        if (sawName) throw new Error("unsafe symlink parent traversal after a path component");
        if (!resolved.length) throw new Error("escaping symlink");
        resolved.pop();
        continue;
      }
      if ([".git", ".gitmodules"].includes(part.toLowerCase())) throw new Error("escaping symlink");
      sawName = true;
      const candidate = [...resolved, part].join("/");
      const redirect = links.get(candidate);
      if (redirect !== undefined) {
        if (++expansions > 40) throw new Error("cyclic symlink");
        pending.unshift(...redirect.split("/"));
      } else {
        resolved.push(part);
      }
    }
  }
}

function writeTree(store: string, root: string, tree: string): void {
  const list = entries(store, tree);
  assertSymlinks(list, store);
  const symlinkPaths = new Set(list.filter((entry) => entry.mode === "120000").map((entry) => entry.path));
  for (const entry of list) {
    let prefix = "";
    for (const part of entry.path.split("/").slice(0, -1)) {
      prefix = prefix ? `${prefix}/${part}` : part;
      if (symlinkPaths.has(prefix)) throw new Error("source path traverses a symlink");
    }
  }
  for (const entry of list) {
    const destination = join(root, ...entry.path.split("/"));
    mkdirSync(dirname(destination), { recursive: true });
    if (entry.mode === "120000") symlinkSync(blob(store, entry.oid).toString("utf8"), destination);
    else {
      writeFileSync(destination, blob(store, entry.oid), { flag: "wx", mode: entry.mode === "100755" ? 0o755 : 0o644 });
      chmodSync(destination, entry.mode === "100755" ? 0o755 : 0o644);
    }
  }
}

function clearWorktree(root: string): void {
  for (const name of readdirSync(root)) {
    if (name === ".git") continue;
    const path = join(root, name);
    // This directory is created by this function and contains only exported entries.
    if (lstatSync(path).isDirectory()) rmSync(path, { recursive: true });
    else unlinkSync(path);
  }
}

/** Materializes only exact endpoints. It makes no claim about historical ancestry. */
export function materializeDevelopmentEndpoints(input: DevelopmentEndpointInput): DevelopmentEndpointResult {
  for (const [label, value] of [["baseCommit", input.baseCommit], ["baseTree", input.baseTree], ["headCommit", input.headCommit], ["headTree", input.headTree]] as const) oid(value, label);
  if (!SHA256.test(input.retainedDiffSha256)) throw new Error("retainedDiffSha256 must be SHA-256");
  const store = realpathSync(input.sourceBareStore);
  const output = resolve(input.outputDirectory);
  if (existsSync(output)) throw new Error("output directory already exists");
  const parent = realpathSync(dirname(output));
  if (parent === store || parent.startsWith(`${store}/`)) throw new Error("output must be outside source store");
  assertStore(store);
  for (const [commit, expected] of [[input.baseCommit, input.baseTree], [input.headCommit, input.headTree]]) {
    if (git(["cat-file", "-t", commit!], store).toString("utf8").trim() !== "commit") throw new Error("source endpoint is not a commit");
    if (git(["cat-file", "-t", expected!], store).toString("utf8").trim() !== "tree") throw new Error("source endpoint is not a tree");
    const actual = git(["show", "-s", "--format=%T", commit!], store).toString("utf8").trim();
    if (actual !== expected) throw new Error("source endpoint commit/tree mismatch");
    entries(store, expected!);
  }
  const retained = readFileSync(input.retainedDiffPath);
  const digest = createHash("sha256").update(retained).digest("hex");
  if (digest !== input.retainedDiffSha256) throw new Error("retained diff SHA-256 mismatch");
  const actualDiff = git(["diff", "--no-ext-diff", "--no-textconv", "--full-index", input.baseCommit, input.headCommit], store);
  if (!retained.equals(actualDiff)) throw new Error("retained diff bytes differ from exact endpoints");
  mkdirSync(output);
  const repo = join(output, "repository");
  mkdirSync(repo);
  const gitDir = join(repo, ".git");
  git(["init", "--quiet", "--initial-branch=review", repo], gitDir, repo);
  const neutralCommits: string[] = [];
  for (const tree of [input.baseTree, input.headTree]) {
    clearWorktree(repo);
    writeTree(store, repo, tree);
    git(["add", "--force", "--all"], gitDir, repo);
    const neutralTree = git(["write-tree"], gitDir, repo).toString("utf8").trim();
    if (neutralTree !== tree) throw new Error("neutral tree differs from source tree");
    const args = ["-c", "user.name=Peregrine Evidence", "-c", "user.email=evidence@invalid.example", "commit-tree", neutralTree];
    if (neutralCommits.length) args.push("-p", neutralCommits[0]!);
    const message = Buffer.from(neutralCommits.length ? "Neutral review head\n" : "Neutral review base\n");
    const commit = execFileSync("git", [...args, "-F", "-"], { cwd: repo, env: { PATH: process.env.PATH, GIT_DIR: gitDir, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_NO_REPLACE_OBJECTS: "1", GIT_AUTHOR_DATE: "2000-01-01T00:00:00Z", GIT_COMMITTER_DATE: "2000-01-01T00:00:00Z" }, input: message, encoding: "utf8" }).trim();
    neutralCommits.push(commit);
  }
  git(["update-ref", "refs/heads/review", neutralCommits[1]!], gitDir, repo);
  for (const [commit, tree] of [[neutralCommits[0], input.baseTree], [neutralCommits[1], input.headTree]]) {
    if (git(["show", "-s", "--format=%T", commit!], gitDir, repo).toString("utf8").trim() !== tree) throw new Error("neutral commit tree mismatch");
  }
  if (git(["status", "--porcelain"], gitDir, repo).length) throw new Error("neutral review head is dirty");
  if (git(["for-each-ref", "--format=%(refname)"], gitDir, repo).toString("utf8").trim() !== "refs/heads/review") throw new Error("neutral repository has extra refs");
  if (git(["remote"], gitDir, repo).length) throw new Error("neutral repository has a remote");
  return { repository: repo, sourceBaseCommit: input.baseCommit, sourceHeadCommit: input.headCommit, baseCommit: neutralCommits[0]!, headCommit: neutralCommits[1]!, baseTree: input.baseTree, headTree: input.headTree, diffSha256: digest, sourceAncestry: "unestablished" };
}
