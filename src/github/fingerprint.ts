import { createHash } from "node:crypto";
import type { Finding } from "../types.js";

/**
 * Stable identity for a finding so re-pushes don't repost duplicates.
 *
 * Deliberately excludes the title: LLM wording varies run to run, and a
 * reworded title would defeat dedupe in the noisy direction (duplicate
 * comments — exactly what kills bot adoption). file + category + a 10-line
 * band is stable across runs and tolerant of small line drift; a rebase that
 * moves code across a band boundary may repost once, and a same-file,
 * same-category, same-band collision stays quiet — the right failure mode
 * for a review bot.
 */
export function fingerprint(f: Finding): string {
  const band = Math.floor(f.startLine / 10);
  return createHash("sha256")
    .update(`${f.file}|${f.category.toLowerCase()}|${band}`)
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
