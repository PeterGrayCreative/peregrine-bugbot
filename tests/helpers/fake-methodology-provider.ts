import { basename, dirname, join, relative } from "node:path";
import { chmodSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import {
  ACCEPTED_EVAL_RUNTIME_IMAGE,
  createStructuralMockMethodologyProviderAttacher,
  observeMethodologyProviderAttacher,
  type MethodologyProviderAttachmentRequest,
  type MethodologyProviderAttacher,
} from "../../eval/methodology-provider-attachment.js";
import type { exec } from "../../src/util/exec.js";

const READ_LIMITS = {
  maxIndexEntries: 20_000,
  maxFileBytes: 2 * 1024 * 1024,
  maxOutputBytes: 2 * 1024 * 1024,
  maxSearchMatches: 500,
  excludedNamespaces: [],
};
const MCP_LIMITS = {
  maxRequestBytes: 64 * 1024,
  maxResponseBytes: 2 * 1024 * 1024,
  requestTimeoutMs: 10_000,
  maxConnections: 4,
  maxRequests: 200,
};

export interface FakeMethodologyInvocation {
  request: MethodologyProviderAttachmentRequest;
  prompt: string;
  schema: string;
  outputPath: string;
  dockerArgs: readonly string[];
}

export interface FakeMethodologyResponse {
  text: string;
  code?: number;
  timedOut?: boolean;
  writeOutput?: boolean;
}

export function createFakeMethodologyProvider(input: {
  response(invocation: FakeMethodologyInvocation): string | FakeMethodologyResponse;
  onRequest?(request: MethodologyProviderAttachmentRequest): void;
  onInvocation?(invocation: FakeMethodologyInvocation): void;
}): { attachProvider: MethodologyProviderAttacher; calls: string[][] } {
  const calls: string[][] = [];
  const requests = new Map<string, MethodologyProviderAttachmentRequest>();
  const run: typeof exec = async (command, args, options) => {
    calls.push([command, ...args]);
    if (command !== "docker") throw new Error("fake methodology provider only supports Docker");
    if (args[0] === "rm") return success();
    if (args[0] === "ps") return success();
    if (args[0] !== "run") throw new Error("unexpected fake Docker operation");
    const outputRoot = mountSource(args, "/output");
    const request = requests.get(realpathSync(outputRoot));
    if (!request) throw new Error("fake Docker launch is not bound to an attachment request");
    const imageIndex = args.indexOf(ACCEPTED_EVAL_RUNTIME_IMAGE);
    if (imageIndex < 0 || args[imageIndex + 1] !== "codex") throw new Error("fake Docker launch lacks the accepted Codex image");
    const providerArgs = args.slice(imageIndex + 2);
    const schema = basename(argumentAfter(providerArgs, "--output-schema"));
    const containerOutput = argumentAfter(providerArgs, "--output-last-message");
    if (!containerOutput.startsWith("/output/")) throw new Error("fake provider output is outside /output");
    const outputPath = join(outputRoot, relative("/output", containerOutput));
    const invocation = { request, prompt: options?.stdin ?? "", schema, outputPath, dockerArgs: [...args] };
    input.onInvocation?.(invocation);
    const value = input.response(invocation);
    const response = typeof value === "string" ? { text: value } : value;
    if (response.writeOutput !== false && (response.code ?? 0) === 0 && !response.timedOut) {
      mkdirSync(dirname(outputPath), { recursive: true, mode: 0o700 });
      writeFileSync(outputPath, response.text, { mode: 0o600 });
      chmodSync(outputPath, 0o600);
    }
    return { stdout: "", stderr: "", code: response.code ?? 0, timedOut: response.timedOut ?? false };
  };
  const trusted = createStructuralMockMethodologyProviderAttacher({
    providerAccess: "api-key",
    readToolLimits: READ_LIMITS,
    mcpLimits: MCP_LIMITS,
    outputByteLimit: 4 * 1024 * 1024,
    run,
  });
  process.env.OPENAI_API_KEY ??= "synthetic-methodology-test-key";
  return {
    calls,
    attachProvider: observeMethodologyProviderAttacher(trusted, (request) => {
      input.onRequest?.(request);
      requests.set(realpathSync(request.paths.output), request);
    }),
  };
}

function mountSource(args: readonly string[], target: string): string {
  const suffix = `,target=${target}`;
  const mount = args.find((value) => value.startsWith("type=bind,source=") &&
    (value.endsWith(suffix) || value.endsWith(`${suffix},readonly`)));
  if (!mount) throw new Error(`fake Docker launch lacks ${target} mount`);
  return mount.slice("type=bind,source=".length, mount.indexOf(",target="));
}

function argumentAfter(args: readonly string[], flag: string): string {
  const index = args.indexOf(flag);
  const value = index < 0 ? undefined : args[index + 1];
  if (!value) throw new Error(`fake provider launch lacks ${flag}`);
  return value;
}

function success() {
  return { stdout: "", stderr: "", code: 0, timedOut: false };
}
