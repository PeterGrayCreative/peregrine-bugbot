import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const imageRoot = resolve("container/eval-runtime");
const dockerfile = readFileSync(resolve(imageRoot, "Dockerfile"), "utf8");
const imagePackage = JSON.parse(readFileSync(resolve(imageRoot, "package.json"), "utf8")) as {
  dependencies: Record<string, string>;
  engines: { node: string };
};
const imageLock = JSON.parse(readFileSync(resolve(imageRoot, "package-lock.json"), "utf8")) as {
  lockfileVersion: number;
  packages: Record<string, { version?: string; integrity?: string }>;
};
const workflow = readFileSync(resolve(".github/workflows/eval-runtime-image.yml"), "utf8");
const setupAction = readFileSync(resolve(".github/actions/setup-peregrine/action.yml"), "utf8");

test("the runtime image pins its base and provider toolchain", () => {
  assert.match(
    dockerfile,
    /^FROM node:22\.22\.1-bookworm-slim@sha256:4f77a690f2f8946ab16fe1e791a3ac0667ae1c3575c3e4d0d4589e9ed5bfaf3d$/m,
  );
  assert.equal(imagePackage.engines.node, "22.22.1");
  assert.deepEqual(imagePackage.dependencies, {
    "@anthropic-ai/claude-code": "2.1.252",
    "@openai/codex": "0.152.0",
  });
  assert.match(setupAction, /@anthropic-ai\/claude-code@2\.1\.252/);
  assert.match(setupAction, /@openai\/codex@0\.152\.0/);
  assert.equal(imageLock.lockfileVersion, 3);
  for (const [name, version] of Object.entries(imagePackage.dependencies)) {
    const locked = imageLock.packages[`node_modules/${name}`];
    assert.equal(locked?.version, version);
    assert.match(locked?.integrity ?? "", /^sha512-/);
  }
});

test("the image context cannot copy the repository or curator data", () => {
  assert.equal(
    readFileSync(resolve(imageRoot, ".dockerignore"), "utf8"),
    "*\n!Dockerfile\n!package.json\n!package-lock.json\n!containment-probe.mjs\n",
  );
  assert.doesNotMatch(dockerfile, /^COPY\s+\.?\.?(?:\s|$)/m);
  assert.match(dockerfile, /^USER node$/m);
  assert.match(dockerfile, /^CMD \["peregrine-containment-probe", "--check"\]$/m);
});

test("the image workflow keeps pull requests unprivileged and publication manual", () => {
  assert.match(workflow, /^  pull_request:$/m);
  assert.match(workflow, /^  workflow_dispatch:$/m);
  assert.doesNotMatch(workflow, /pull_request_target/);

  const [verify, publish] = workflow.split("\n  publish:\n");
  assert.ok(verify && publish);
  assert.doesNotMatch(verify, /packages:\s*write/);
  assert.doesNotMatch(verify, /secrets\./);
  assert.doesNotMatch(verify, /docker\/login-action/);
  assert.doesNotMatch(verify, /push:\s*true/);
  assert.match(verify, /persist-credentials: false/);
  assert.match(verify, /--network none/);
  assert.match(verify, /--read-only/);
  assert.match(verify, /--cap-drop ALL/);
  assert.match(verify, /--security-opt no-new-privileges/);
  assert.match(verify, /target=\/workspace,readonly/);
  assert.match(verify, /target=\/opt\/peregrine,readonly/);
  assert.match(verify, /target=\/output/);

  assert.match(publish, /github\.event_name == 'workflow_dispatch'/);
  assert.match(publish, /github\.ref == 'refs\/heads\/main'/);
  assert.match(publish, /packages: write/);
  assert.match(workflow, /IMAGE_NAME: ghcr\.io\/petergraycreative\/peregrine-eval-runtime/);
  assert.match(publish, /tags: \$\{\{ env\.IMAGE_NAME \}\}:\$\{\{ github\.sha \}\}/);
  assert.doesNotMatch(publish, /:latest/);
});

test("every workflow action and helper image is immutable", () => {
  const actionReferences = [...workflow.matchAll(/uses:\s*([^\s#]+)/g)].map((match) => match[1] ?? "");
  assert.ok(actionReferences.length >= 6);
  for (const reference of actionReferences) {
    assert.match(reference, /@[a-f0-9]{40}$/);
  }
  assert.match(
    workflow,
    /docker\.io\/tonistiigi\/binfmt@sha256:400a4873b838d1b89194d982c45e5fb3cda4593fbfd7e08a02e76b03b21166f0/,
  );
  assert.match(workflow, /version: v0\.37\.0/);
  assert.match(
    workflow,
    /docker\.io\/moby\/buildkit@sha256:28a898719c18a33f4e8000685287fa36fd0dd9560c6440227d3a732d79bb41d8/,
  );
});

test("the zero-credential probe exposes a stable mount contract", () => {
  const result = spawnSync(process.execPath, [resolve(imageRoot, "containment-probe.mjs"), "--describe"], {
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "" },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    schemaVersion: 1,
    user: { uid: 1000, gid: 1000 },
    mounts: {
      checkout: { path: "/workspace", access: "read-only", marker: "checkout" },
      assets: { path: "/opt/peregrine", access: "read-only", marker: "assets" },
      output: { path: "/output", access: "read-write" },
      home: { path: "/home/peregrine", type: "tmpfs" },
      scratch: { path: "/tmp", type: "tmpfs" },
    },
    providerVersions: { claude: "2.1.252", codex: "0.152.0" },
  });
});

test("the merged live-provider gate remains closed", () => {
  const isolation = readFileSync(resolve("eval/case-isolation.ts"), "utf8");
  assert.match(
    isolation,
    /export function assertLiveProviderIsolationAvailable\(runner: RunnerName\): void \{\n  if \(runner === "mock"\) return;\n  throw new Error\(/,
  );
  assert.match(isolation, /live \$\{runner\} evaluation is disabled until an externally enforced filesystem and network allowlist/);
});
