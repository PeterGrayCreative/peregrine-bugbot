import { createHash } from "node:crypto";
import type { Finding } from "../types.js";

/**
 * Stable identity for a finding so re-pushes don't repost duplicates.
 *
 * A five-line band tolerates minor line drift. Normalized title keywords keep
 * distinct root causes in the same category/band from suppressing each other
 * without making punctuation or casing changes produce a new comment.
 */
export function fingerprint(f: Finding): string {
  const band = Math.floor(f.startLine / 5);
  const rootKeywords = f.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 2)
    .slice(0, 6)
    .join("-");
  return createHash("sha256")
    .update(`${f.file}|${f.category}|${band}|${rootKeywords}`)
    .digest("hex")
    .slice(0, 16);
}

export const MARKER_PREFIX = "<!-- peregrine:";

export function marker(fp: string): string {
  return `${MARKER_PREFIX}${fp} -->`;
}

export function extractFingerprints(body: string): string[] {
  return [...body.matchAll(/<!-- peregrine:([a-f0-9]{16}) -->/g)].map((m) => m[1]!);
}
