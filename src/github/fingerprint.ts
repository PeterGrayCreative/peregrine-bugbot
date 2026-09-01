import { createHash } from "node:crypto";
import type { Finding } from "../types.js";

/**
 * Stable identity for a finding so re-pushes don't repost duplicates.
 *
 * A five-line band tolerates minor line drift. The model contract requires a
 * stable invariant slug so harmless title rewrites do not create duplicates.
 */
export function fingerprint(f: Finding): string {
  const band = Math.floor(f.startLine / 5);
  return createHash("sha256")
    .update(`${f.file}|${f.category}|${band}|${f.invariant}`)
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
