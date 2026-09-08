import { closeSync, constants, fstatSync, lstatSync, openSync, opendirSync, readSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
export const REVIEW_READ_TOOLS_BOUNDARY = "Read-only functions over a caller-authenticated immutable source export. No transport, provider integration, credential containment, process isolation, or complete runner scope is established.";
/** The caller must authenticate and freeze this exported tree before creation.
 * Metadata checks and O_NOFOLLOW detect ordinary drift; they are not a sandbox
 * against concurrent hostile filesystem mutation or hard links into other data. */
export function createReviewReadTools(exportRoot, limits) {
    exact(limits, ["maxIndexEntries", "maxFileBytes", "maxOutputBytes", "maxSearchMatches", "excludedNamespaces"]);
    for (const name of ["maxIndexEntries", "maxFileBytes", "maxOutputBytes", "maxSearchMatches"]) {
        if (!Number.isSafeInteger(limits[name]) || limits[name] < 1 || limits[name] > 100_000_000)
            throw new Error(`invalid ${name}`);
    }
    if (limits.maxOutputBytes < 512)
        throw new Error("maxOutputBytes must be at least 512");
    if (!Array.isArray(limits.excludedNamespaces))
        throw new Error("excludedNamespaces must be an array");
    const excluded = limits.excludedNamespaces.map((path) => parsePath(path, false));
    const budget = { ...limits, excludedNamespaces: [...excluded] };
    if (typeof exportRoot !== "string" || exportRoot.length === 0)
        throw new Error("exportRoot must be a directory");
    const absolute = resolve(exportRoot);
    const rootStat = lstatSync(absolute);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink())
        throw new Error("exportRoot must be a direct directory");
    const root = realpathSync(absolute);
    const indexed = new Map();
    indexed.set("", { path: "", type: "directory", fingerprint: rootStat });
    const indexUnavailable = [];
    let observed = 0;
    let indexTruncated = false;
    const queue = [""];
    for (let cursor = 0; cursor < queue.length && !indexTruncated; cursor++) {
        const parent = queue[cursor];
        let directory;
        try {
            assertUnchanged(parent);
            directory = opendirSync(join(root, parent));
        }
        catch {
            indexUnavailable.push({ path: parent, reason: "directory-unavailable" });
            continue;
        }
        try {
            for (;;) {
                const child = directory.readSync();
                if (!child)
                    break;
                if (observed >= budget.maxIndexEntries) {
                    indexTruncated = true;
                    break;
                }
                observed++;
                const path = parent ? `${parent}/${child.name}` : child.name;
                try {
                    parsePath(path, false);
                }
                catch {
                    indexUnavailable.push({ path: parent, reason: "unsupported-entry-name" });
                    continue;
                }
                if (isExcluded(path)) {
                    indexUnavailable.push({ path, reason: "excluded-namespace" });
                    continue;
                }
                try {
                    const stat = lstatSync(join(root, path));
                    if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) {
                        indexUnavailable.push({ path, reason: "unsupported-file-type" });
                        continue;
                    }
                    indexed.set(path, { path, type: stat.isDirectory() ? "directory" : "file", fingerprint: stat });
                    if (stat.isDirectory())
                        queue.push(path);
                }
                catch {
                    indexUnavailable.push({ path, reason: "entry-unavailable" });
                }
            }
        }
        finally {
            directory.closeSync();
        }
    }
    if (indexTruncated)
        indexUnavailable.push({ path: "", reason: "index-entry-limit" });
    function isExcluded(path) {
        const lower = path.toLowerCase();
        return lower.split("/").includes(".git") || excluded.some((prefix) => lower === prefix.toLowerCase() || lower.startsWith(`${prefix.toLowerCase()}/`));
    }
    function validatePath(value, allowRoot) {
        const path = parsePath(value, allowRoot);
        if (isExcluded(path))
            throw new Error("excluded namespace");
        return path;
    }
    function assertUnchanged(path) {
        const parts = path === "" ? [] : path.split("/");
        for (let length = 0; length <= parts.length; length++) {
            const prefix = parts.slice(0, length).join("/");
            const entry = indexed.get(prefix);
            if (!entry)
                throw new Error("unindexed-path");
            const stat = lstatSync(join(root, prefix));
            if (stat.isSymbolicLink() || (entry.type === "directory" ? !stat.isDirectory() : !stat.isFile()) ||
                !same(stat, entry.fingerprint))
                throw new Error("export-changed");
        }
    }
    function read(path) {
        assertUnchanged(path);
        const entry = indexed.get(path);
        if (entry.type !== "file")
            throw new Error("not-a-file");
        if (entry.fingerprint.size > budget.maxFileBytes)
            throw new Error("file-byte-limit");
        const descriptor = openSync(join(root, path), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
        try {
            const before = fstatSync(descriptor);
            if (!before.isFile() || !same(before, entry.fingerprint))
                throw new Error("export-changed");
            const bytes = Buffer.alloc(entry.fingerprint.size);
            let offset = 0;
            while (offset < bytes.length) {
                const count = readSync(descriptor, bytes, offset, bytes.length - offset, offset);
                if (count === 0)
                    throw new Error("export-changed");
                offset += count;
            }
            if (!same(fstatSync(descriptor), before))
                throw new Error("export-changed");
            if (bytes.some((value) => value < 32 && value !== 9 && value !== 10 && value !== 13 || value === 127))
                throw new Error("binary-content");
            try {
                return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
            }
            catch {
                throw new Error("invalid-utf8");
            }
        }
        finally {
            closeSync(descriptor);
        }
    }
    function result(fields, unavailable, truncated = false) {
        const output = { status: unavailable.length || truncated ? "incomplete" : "complete-for-indexed-export",
            truncated, limitations: [...new Set(unavailable.map((item) => item.reason))].sort(), unavailable, ...fields };
        if (Buffer.byteLength(JSON.stringify(output)) <= budget.maxOutputBytes)
            return output;
        output.status = "incomplete";
        output.truncated = true;
        output.limitations.push("output-byte-limit");
        output.unavailable = [{ path: "", reason: "output-byte-limit" }];
        if (output.text !== undefined)
            output.text = null;
        const key = output.entries ? "entries" : output.matches ? "matches" : null;
        if (key) {
            const rows = output[key];
            let low = 0;
            let high = rows.length;
            while (low < high) {
                const middle = Math.ceil((low + high) / 2);
                const candidate = { ...output, [key]: rows.slice(0, middle) };
                if (Buffer.byteLength(JSON.stringify(candidate)) <= budget.maxOutputBytes)
                    low = middle;
                else
                    high = middle - 1;
            }
            if (key === "entries")
                output.entries = rows.slice(0, low);
            else
                output.matches = rows.slice(0, low);
        }
        return output;
    }
    function failure(path, error) {
        const message = error instanceof Error ? error.message : "";
        return { path, reason: ["unindexed-path", "export-changed", "not-a-file", "file-byte-limit", "binary-content", "invalid-utf8"].includes(message)
                ? message : "file-unavailable" };
    }
    return {
        list_tree(args = {}) {
            exact(args, [], ["path"]);
            const path = validatePath(Object.hasOwn(args, "path") ? args.path : "", true);
            try {
                assertUnchanged(path);
            }
            catch (error) {
                return result({ entries: [] }, [failure(path, error)]);
            }
            if (indexed.get(path).type !== "directory")
                return result({ entries: [] }, [{ path, reason: "not-a-directory" }]);
            const entries = [];
            const unavailable = [...indexUnavailable];
            for (const entry of [...indexed.values()].sort((a, b) => compare(a.path, b.path))) {
                if (entry.path === "" || !(path === "" || entry.path.startsWith(`${path}/`)))
                    continue;
                try {
                    assertUnchanged(entry.path);
                    entries.push({ path: entry.path, type: entry.type });
                }
                catch (error) {
                    unavailable.push(failure(entry.path, error));
                }
            }
            return result({ entries }, unavailable, indexTruncated);
        },
        read_file(args) {
            exact(args, ["path"]);
            const path = validatePath(args.path, false);
            try {
                return result({ text: read(path) }, []);
            }
            catch (error) {
                return result({ text: null }, [failure(path, error)]);
            }
        },
        search_text(args) {
            exact(args, ["query"], ["path"]);
            const path = validatePath(Object.hasOwn(args, "path") ? args.path : "", true);
            if (typeof args.query !== "string" || !args.query || Buffer.byteLength(args.query) > 1024 || /[\r\n\0]/.test(args.query))
                throw new Error("query must be a nonempty single-line literal of at most 1024 bytes");
            try {
                assertUnchanged(path);
            }
            catch (error) {
                return result({ matches: [] }, [failure(path, error)]);
            }
            const matches = [];
            const unavailable = [...indexUnavailable];
            let capped = false;
            for (const entry of [...indexed.values()].sort((a, b) => compare(a.path, b.path))) {
                if (!(path === "" || entry.path === path || entry.path.startsWith(`${path}/`)))
                    continue;
                if (entry.type === "directory") {
                    try {
                        assertUnchanged(entry.path);
                    }
                    catch (error) {
                        unavailable.push(failure(entry.path, error));
                    }
                    continue;
                }
                let text;
                try {
                    text = read(entry.path);
                }
                catch (error) {
                    unavailable.push(failure(entry.path, error));
                    continue;
                }
                for (const [line, value] of text.split("\n").entries()) {
                    if (!value.includes(args.query))
                        continue;
                    if (matches.length === budget.maxSearchMatches) {
                        capped = true;
                        break;
                    }
                    matches.push({ path: entry.path, line: line + 1, text: value });
                }
                if (capped)
                    break;
            }
            if (capped)
                unavailable.push({ path, reason: "search-match-limit" });
            return result({ matches }, unavailable, capped || indexTruncated);
        },
    };
}
function parsePath(value, allowRoot) {
    if (typeof value !== "string" || value.length > 4096 || (!allowRoot && value === "") ||
        /[\\\x00-\x1f\x7f]/.test(value) || (value !== "" && value.split("/").some((part) => part === "" || part === "." || part === "..")))
        throw new Error("path must be a canonical relative export path");
    return value;
}
function exact(value, required, optional = []) {
    if (!value || typeof value !== "object" || Array.isArray(value) ||
        required.some((key) => !Object.hasOwn(value, key)) ||
        Object.keys(value).some((key) => !required.includes(key) && !optional.includes(key)))
        throw new Error("invalid tool arguments");
}
function same(a, b) {
    return a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;
}
function compare(a, b) { return a < b ? -1 : a > b ? 1 : 0; }
