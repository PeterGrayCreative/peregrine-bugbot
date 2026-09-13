import { createHash } from "node:crypto";
import { canonicalJson } from "./experiment.js";

/** These primitives describe synthetic preparation, never admitted reference truth. */
export const PREDICTION_BOUNDARY = "synthetic-preparation-only; no provider dispatch, mount attestation, admitted truth, or execution readiness";
export function digest(value: unknown): string { return sha(canonicalJson(value)); }
export function sha(bytes: string | Buffer): string { return createHash("sha256").update(bytes).digest("hex"); }
export function exact(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label}: expected object`);
  const item = value as Record<string, unknown>;
  if (Object.keys(item).length !== keys.length || keys.some(key => !Object.hasOwn(item, key))) throw new Error(`${label}: unexpected or missing field`);
  return item;
}
export function text(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.includes("\0") || value.length > 100_000) throw new Error("invalid text");
  return value;
}
export function hash(value: unknown): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) throw new Error("invalid digest");
  return value;
}
export function integer(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error("invalid nonnegative integer");
  return Number(value);
}
export function oneOf<T extends string>(value: unknown, choices: readonly T[]): T {
  if (!choices.includes(value as T)) throw new Error("invalid category");
  return value as T;
}
export function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error("expected array");
  return value;
}
export function same(left: unknown, right: unknown, message: string): void {
  if (canonicalJson(left) !== canonicalJson(right)) throw new Error(message);
}
export function unique(values: readonly string[]): void {
  if (new Set(values).size !== values.length) throw new Error("duplicate identifier");
}
/** Clone before freezing so callers cannot mutate a sealed object's nested inputs. */
export function freeze<T>(value: T): T {
  const clone = JSON.parse(canonicalJson(value)) as T;
  function visit(item: unknown): void {
    if (item && typeof item === "object") { Object.values(item).forEach(visit); Object.freeze(item); }
  }
  visit(clone);
  return clone;
}
