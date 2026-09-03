#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  args.set(process.argv[index], process.argv[index + 1] ?? "");
}
const required = (name) => {
  const value = args.get(name);
  if (value === undefined) throw new Error(`missing ${name}`);
  return value;
};
required("--repo");
const mergeBase = required("--merge-base");
const headCommit = required("--head-commit");
const decoder = new TextDecoder("utf-8", { fatal: true });
const splitNul = (buffer) => decoder.decode(buffer).split("\0").filter((part) => part !== "");

const statuses = splitNul(readFileSync(required("--status-records")));
const files = new Map();
for (let index = 0; index < statuses.length;) {
  const status = statuses[index++];
  if (/^[RC]/.test(status)) {
    const oldPath = statuses[index++];
    const path = statuses[index++];
    files.set(path, { path, status, oldPath, additions: null, deletions: null, binary: false, activatedLanes: [] });
  } else {
    const path = statuses[index++];
    files.set(path, { path, status, additions: null, deletions: null, binary: false, activatedLanes: [] });
  }
}

const numstat = splitNul(readFileSync(required("--numstat-records")));
for (let index = 0; index < numstat.length;) {
  const entry = numstat[index++];
  const firstTab = entry.indexOf("\t");
  const secondTab = entry.indexOf("\t", firstTab + 1);
  if (firstTab < 0 || secondTab < 0) throw new Error("malformed numstat record");
  const added = entry.slice(0, firstTab);
  const deleted = entry.slice(firstTab + 1, secondTab);
  let path = entry.slice(secondTab + 1);
  if (!path) {
    index += 1; // old rename path
    path = numstat[index++];
  }
  const file = files.get(path);
  if (!file) throw new Error(`numstat path missing from status inventory: ${JSON.stringify(path)}`);
  file.binary = added === "-" || deleted === "-";
  file.additions = file.binary ? null : Number(added);
  file.deletions = file.binary ? null : Number(deleted);
}

const coreLaneIds = new Set(splitNul(readFileSync(required("--core-lanes"))));
if (coreLaneIds.size === 0) throw new Error("canonical core-lane inventory is empty");
const customLanes = new Map();
const customLaneFields = splitNul(readFileSync(required("--custom-lanes")));
const customLaneText = [];
for (let index = 0; index < customLaneFields.length; index += 3) {
  const id = customLaneFields[index];
  const trustedSource = customLaneFields[index + 1];
  const quotedSource = customLaneFields[index + 2];
  if (id === undefined || trustedSource === undefined || quotedSource === undefined) throw new Error("malformed custom-lane record");
  customLanes.set(id, trustedSource);
  customLaneText.push({ id, quotedSource });
}
const activationFields = splitNul(readFileSync(required("--activations")));
for (let index = 0; index < activationFields.length; index += 3) {
  const path = activationFields[index];
  const id = activationFields[index + 1];
  const reason = activationFields[index + 2];
  if (path === undefined || id === undefined || reason === undefined) throw new Error("malformed activation record");
  const file = files.get(path);
  if (!file) throw new Error(`activation path missing from changed files: ${JSON.stringify(path)}`);
  if (!file.activatedLanes.some((item) => item.id === id && item.reason === reason)) {
    file.activatedLanes.push({ id, reason });
  }
  if (!coreLaneIds.has(id) && !customLanes.has(id)) throw new Error(`custom lane lacks trusted source: ${id}`);
}
for (const file of files.values()) {
  file.activatedLanes.sort((a, b) => a.id.localeCompare(b.id) || a.reason.localeCompare(b.reason));
}

const requestedProfile = required("--profile-requested");
const rawProfileSource = required("--profile-source");
const profileSource = rawProfileSource === "merge-base snapshot" ? "merge-base"
  : rawProfileSource === "trusted external path" || rawProfileSource === "trusted working tree" ? "external"
    : "none";
const changedAtHead = required("--profile-changed-at-head") === "1";
const warnings = changedAtHead
  ? ["head changes to the repository profile or custom lanes are ignored; review them as untrusted code or rerun with --trust-working-tree-profile after explicit approval"]
  : [];
const changedFiles = [...files.values()].sort((a, b) => a.path.localeCompare(b.path));
const activatedLanes = [...new Set(changedFiles.flatMap((file) => file.activatedLanes.map((lane) => lane.id)))].sort();
const largeFileFields = splitNul(readFileSync(required("--large-files")));
const largeFiles = [];
const largeFileText = [];
for (let index = 0; index < largeFileFields.length; index += 4) {
  const path = largeFileFields[index];
  const quotedPath = largeFileFields[index + 1];
  const rawBaseLines = largeFileFields[index + 2];
  const rawHeadLines = largeFileFields[index + 3];
  if (path === undefined || quotedPath === undefined || rawBaseLines === undefined || rawHeadLines === undefined) {
    throw new Error("malformed large-file record");
  }
  const baseLines = Number(rawBaseLines);
  const headLines = Number(rawHeadLines);
  if (!Number.isSafeInteger(baseLines) || baseLines < 0 || !Number.isSafeInteger(headLines) || headLines < 400) {
    throw new Error("invalid large-file line counts");
  }
  if (!files.has(path)) throw new Error(`large-file path missing from changed files: ${JSON.stringify(path)}`);
  largeFiles.push({ path, baseLines, headLines });
  largeFileText.push({ path, quotedPath, baseLines, headLines });
}
largeFiles.sort((a, b) => a.path.localeCompare(b.path));
const manifest = {
  schemaVersion: 1,
  available: true,
  base: { ref: required("--base-ref"), commit: required("--base-commit"), source: required("--base-source") },
  head: { ref: required("--head-ref"), commit: headCommit },
  mergeBase,
  profile: {
    source: profileSource,
    requestedPath: requestedProfile || null,
    changedAtHead,
  },
  changedFiles,
  activatedLanes,
  customLanes: [...customLanes].sort(([a], [b]) => a.localeCompare(b)).map(([id, trustedSource]) => ({ id, trustedSource })),
  largeFiles,
  warnings,
};
writeFileSync(required("--output"), `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx", mode: 0o600 });

const laneTextFields = splitNul(readFileSync(required("--lane-text")));
const laneText = [];
for (let index = 0; index < laneTextFields.length; index += 3) {
  if (laneTextFields[index] === undefined || laneTextFields[index + 1] === undefined || laneTextFields[index + 2] === undefined) throw new Error("malformed lane text evidence");
  laneText.push({ id: laneTextFields[index], path: laneTextFields[index + 1], quotedPath: laneTextFields[index + 2] });
}
const parity = {
  statusText: decoder.decode(readFileSync(required("--status-text"))),
  statText: decoder.decode(readFileSync(required("--stat-text"))),
  profileLine: requestedProfile ? `profile: ${requestedProfile} (${rawProfileSource})` : null,
  laneText,
  customLaneText,
  largeFileText,
};
writeFileSync(required("--parity-output"), `${JSON.stringify(parity)}\n`, { flag: "wx", mode: 0o600 });
