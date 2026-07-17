import { createHash } from "node:crypto";
import type { Finding } from "../types.js";

/**
 * Stable identity for a finding so re-pushes don't repost duplicates.
 * Deliberately excludes line numbers (they shift on rebase) — file + category
 * + normalized title is stable enough, and collisions just mean we stay quiet,
 * which is the right failure mode for a review bot.
 */
export function fingerprint(f: Finding): string {
  const normalizedTitle = f.title.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return createHash("sha256")
    .update(`${f.file}|${f.category}|${normalizedTitle}`)
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
