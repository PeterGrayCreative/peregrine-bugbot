import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { loadConfig, validateConfig } from "../src/config.js";
import type { PeregrineConfig } from "../src/types.js";

function config(): PeregrineConfig {
  return JSON.parse(readFileSync(resolve("peregrine.config.json"), "utf8")) as PeregrineConfig;
}

test("the checked-in config and both plugin manifests are internally consistent", () => {
  const current = config();
  assert.doesNotThrow(() => validateConfig(current));
  for (const manifestPath of [".claude-plugin/plugin.json", ".codex-plugin/plugin.json"]) {
    const manifest = JSON.parse(readFileSync(resolve(manifestPath), "utf8")) as {
      name?: string;
      version?: string;
      skills?: string;
    };
    assert.equal(manifest.name, "peregrine");
    assert.equal(manifest.version, "0.2.0");
    if (manifest.skills !== undefined) assert.equal(manifest.skills, "./skills/");
  }
});

test("config validation rejects unknown runners, placeholders, and invalid effort", () => {
  const unknown = config();
  unknown.runner = "other" as PeregrineConfig["runner"];
  assert.throws(() => validateConfig(unknown), /runner.*claude, codex, mock/);

  const placeholder = config();
  placeholder.runners.codex.investigationModel = "TODO";
  assert.throws(() => validateConfig(placeholder), /non-empty configured string/);

  const effort = config();
  effort.runners.claude.investigationEffort = "impossible" as never;
  assert.throws(() => validateConfig(effort), /investigationEffort.*low, medium, high/);
});

test("provider-scoped environment overrides cannot change the other provider", () => {
  const dir = mkdtempSync(join(tmpdir(), "peregrine-config-test-"));
  const path = join(dir, "config.json");
  writeFileSync(path, JSON.stringify(config()));
  const previousRunner = process.env.PEREGRINE_RUNNER;
  const previousModel = process.env.PEREGRINE_CODEX_INVESTIGATION_MODEL;
  try {
    process.env.PEREGRINE_RUNNER = "codex";
    process.env.PEREGRINE_CODEX_INVESTIGATION_MODEL = "codex-test-model";
    const loaded = loadConfig(path);
    assert.equal(loaded.runner, "codex");
    assert.equal(loaded.runners.codex.investigationModel, "codex-test-model");
    assert.equal(loaded.runners.claude.investigationModel, config().runners.claude.investigationModel);
  } finally {
    if (previousRunner === undefined) delete process.env.PEREGRINE_RUNNER;
    else process.env.PEREGRINE_RUNNER = previousRunner;
    if (previousModel === undefined) delete process.env.PEREGRINE_CODEX_INVESTIGATION_MODEL;
    else process.env.PEREGRINE_CODEX_INVESTIGATION_MODEL = previousModel;
    rmSync(dir, { recursive: true, force: true });
  }
});
