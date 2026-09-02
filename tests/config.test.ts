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
  assert.deepEqual(
    {
      breadthModel: current.runners.claude.breadthModel,
      breadthEffort: current.runners.claude.breadthEffort,
      investigationModel: current.runners.claude.investigationModel,
      investigationEffort: current.runners.claude.investigationEffort,
    },
    {
      breadthModel: "claude-sonnet-5",
      breadthEffort: "high",
      investigationModel: "claude-opus-5",
      investigationEffort: "high",
    },
  );
  assert.deepEqual(
    {
      breadthModel: current.runners.codex.breadthModel,
      breadthEffort: current.runners.codex.breadthEffort,
      investigationModel: current.runners.codex.investigationModel,
      investigationEffort: current.runners.codex.investigationEffort,
    },
    {
      breadthModel: "gpt-5.6-luna",
      breadthEffort: "high",
      investigationModel: "gpt-5.6-sol",
      investigationEffort: "high",
    },
  );
  const packageVersion = (
    JSON.parse(readFileSync(resolve("package.json"), "utf8")) as { version: string }
  ).version;
  const lock = JSON.parse(readFileSync(resolve("package-lock.json"), "utf8")) as {
    version: string;
    packages: { "": { version: string } };
  };
  assert.equal(lock.version, packageVersion);
  assert.equal(lock.packages[""].version, packageVersion);
  for (const manifestPath of [".claude-plugin/plugin.json", ".codex-plugin/plugin.json"]) {
    const manifest = JSON.parse(readFileSync(resolve(manifestPath), "utf8")) as {
      name?: string;
      version?: string;
      skills?: string;
    };
    assert.equal(manifest.name, "peregrine");
    assert.equal(manifest.version, packageVersion);
    if (manifest.skills !== undefined) assert.equal(manifest.skills, "./skills/");
  }
  const claudeManifest = JSON.parse(
    readFileSync(resolve(".claude-plugin/plugin.json"), "utf8"),
  ) as {
    userConfig: Record<string, { default: string }>;
  };
  assert.equal(
    claudeManifest.userConfig.claude_breadth_model?.default,
    current.runners.claude.breadthModel,
  );
  assert.equal(
    claudeManifest.userConfig.claude_breadth_effort?.default,
    current.runners.claude.breadthEffort,
  );
  assert.equal(
    claudeManifest.userConfig.claude_investigation_model?.default,
    current.runners.claude.investigationModel,
  );
  assert.equal(
    claudeManifest.userConfig.claude_investigation_effort?.default,
    current.runners.claude.investigationEffort,
  );
  const invocationRouting = readFileSync(
    resolve("skills/invariant-first-pr-review/references/invocation-routing.md"),
    "utf8",
  );
  assert.match(invocationRouting, /gpt-5\.6-luna` \/ `high/);
  assert.match(invocationRouting, /gpt-5\.6-sol` \/ `high/);
  assert.match(invocationRouting, /claude-sonnet-5` \/ `high/);
  assert.match(invocationRouting, /claude-opus-5` \/ `high/);

  const skill = readFileSync(
    resolve("skills/invariant-first-pr-review/SKILL.md"),
    "utf8",
  );
  const orchestration = readFileSync(
    resolve("skills/invariant-first-pr-review/references/two-worker-orchestration.md"),
    "utf8",
  );
  const breadthPacket = readFileSync(
    resolve("skills/invariant-first-pr-review/references/breadth-worker-packet.md"),
    "utf8",
  );
  const investigationPacket = readFileSync(
    resolve("skills/invariant-first-pr-review/references/investigation-worker-packet.md"),
    "utf8",
  );
  assert.match(skill, /calling agent coordinates and renders; it does not perform either review pass/);
  assert.match(orchestration, /one breadth worker/);
  assert.match(orchestration, /one new investigation worker/);
  assert.match(orchestration, /Do not run them in parallel/);
  assert.match(orchestration, /must not replace[\s\S]*investigation itself/);
  assert.match(orchestration, /If the host cannot launch two separate workers at all, stop/);
  assert.match(breadthPacket, /PEREGRINE_ROLE: breadth-worker/);
  assert.match(investigationPacket, /PEREGRINE_ROLE: investigation-worker/);
  assert.match(breadthPacket, /must not invoke Peregrine, spawn/);
  assert.match(investigationPacket, /Do not invoke Peregrine,[\s\S]*spawn agents/);
});

test("Claude and Codex marketplaces resolve Peregrine from the canonical repository", () => {
  const claude = JSON.parse(
    readFileSync(resolve(".claude-plugin/marketplace.json"), "utf8"),
  ) as {
    name: string;
    plugins: Array<{ name: string; source: string }>;
  };
  assert.equal(claude.name, "peregrine");
  assert.equal(claude.plugins.length, 1);
  assert.equal(claude.plugins[0]?.name, "peregrine");
  assert.equal(claude.plugins[0]?.source, "./");

  const codex = JSON.parse(
    readFileSync(resolve(".agents/plugins/marketplace.json"), "utf8"),
  ) as {
    name: string;
    plugins: Array<{
      name: string;
      source: { source: string; url: string; ref: string };
    }>;
  };
  assert.equal(codex.name, "peregrine");
  assert.equal(codex.plugins[0]?.name, "peregrine");
  assert.deepEqual(codex.plugins[0]?.source, {
    source: "url",
    url: "https://github.com/PeterGrayCreative/peregrine-bugbot.git",
    ref: "main",
  });
});

test("config validation rejects unknown runners, placeholders, and invalid effort", () => {
  const unknown = config();
  unknown.runner = "other" as PeregrineConfig["runner"];
  assert.throws(() => validateConfig(unknown), /runner.*claude, codex, mock/);

  const placeholder = config();
  placeholder.runners.codex.investigationModel = "TODO";
  assert.throws(() => validateConfig(placeholder), /non-empty configured string/);

  const effort = config();
  effort.runners.claude.breadthEffort = "impossible" as never;
  assert.throws(() => validateConfig(effort), /breadthEffort.*low, medium, high/);

  const turns = config();
  turns.runners.claude.maxTurns = 2.5;
  assert.throws(() => validateConfig(turns), /maxTurns.*integer/);
});

test("provider-scoped environment overrides cannot change the other provider", () => {
  const dir = mkdtempSync(join(tmpdir(), "peregrine-config-test-"));
  const path = join(dir, "config.json");
  writeFileSync(path, JSON.stringify(config()));
  const previousRunner = process.env.PEREGRINE_RUNNER;
  const previousClaudeBreadthEffort = process.env.PEREGRINE_CLAUDE_BREADTH_EFFORT;
  const previousModel = process.env.PEREGRINE_CODEX_INVESTIGATION_MODEL;
  const previousClaudeMaxTurns = process.env.PEREGRINE_CLAUDE_MAX_TURNS;
  const previousCodexTimeout = process.env.PEREGRINE_CODEX_TIMEOUT_MS;
  try {
    process.env.PEREGRINE_RUNNER = "codex";
    process.env.PEREGRINE_CLAUDE_BREADTH_EFFORT = "xhigh";
    process.env.PEREGRINE_CODEX_INVESTIGATION_MODEL = "codex-test-model";
    process.env.PEREGRINE_CLAUDE_MAX_TURNS = "55";
    process.env.PEREGRINE_CODEX_TIMEOUT_MS = "123456";
    const loaded = loadConfig(path);
    assert.equal(loaded.runner, "codex");
    assert.equal(loaded.runners.claude.breadthEffort, "xhigh");
    assert.equal(loaded.runners.claude.maxTurns, 55);
    assert.equal(loaded.runners.codex.investigationModel, "codex-test-model");
    assert.equal(loaded.runners.codex.timeoutMs, 123456);
    assert.equal(loaded.runners.claude.investigationModel, config().runners.claude.investigationModel);
  } finally {
    if (previousRunner === undefined) delete process.env.PEREGRINE_RUNNER;
    else process.env.PEREGRINE_RUNNER = previousRunner;
    if (previousClaudeBreadthEffort === undefined) delete process.env.PEREGRINE_CLAUDE_BREADTH_EFFORT;
    else process.env.PEREGRINE_CLAUDE_BREADTH_EFFORT = previousClaudeBreadthEffort;
    if (previousModel === undefined) delete process.env.PEREGRINE_CODEX_INVESTIGATION_MODEL;
    else process.env.PEREGRINE_CODEX_INVESTIGATION_MODEL = previousModel;
    if (previousClaudeMaxTurns === undefined) delete process.env.PEREGRINE_CLAUDE_MAX_TURNS;
    else process.env.PEREGRINE_CLAUDE_MAX_TURNS = previousClaudeMaxTurns;
    if (previousCodexTimeout === undefined) delete process.env.PEREGRINE_CODEX_TIMEOUT_MS;
    else process.env.PEREGRINE_CODEX_TIMEOUT_MS = previousCodexTimeout;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("schema version 1 configs without Claude breadth effort migrate to high", () => {
  const dir = mkdtempSync(join(tmpdir(), "peregrine-config-compat-"));
  const path = join(dir, "config.json");
  const legacy = JSON.parse(JSON.stringify(config())) as {
    runners: { claude: Partial<PeregrineConfig["runners"]["claude"]> };
  };
  delete legacy.runners.claude.breadthEffort;
  try {
    writeFileSync(path, JSON.stringify(legacy));
    assert.equal(loadConfig(path).runners.claude.breadthEffort, "high");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
