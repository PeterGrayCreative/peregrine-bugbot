import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  runTrustedLocalReviewPair,
  type TrustedLocalReviewPairInput,
} from "../../eval/trusted-local-review-runner.js";

export function parseTrustedLocalReviewArgs(args: string[]): TrustedLocalReviewPairInput {
  if (args.length !== 2 || args[0] !== "--config" || !args[1]) {
    throw new Error("expected --config FILE");
  }
  const parsed = JSON.parse(readFileSync(resolve(args[1]), "utf8")) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("config must be an object");
  const config = parsed as Record<string, unknown>;
  const keys = ["caseId", "checkoutDirectory", "authFile", "attemptRoot", "scope", "activatedLanes"];
  if (Object.keys(config).some((key) => !keys.includes(key)) || keys.some((key) => !Object.hasOwn(config, key))) {
    throw new Error("config fields are invalid");
  }
  if (typeof config.caseId !== "string" || typeof config.checkoutDirectory !== "string" ||
      typeof config.authFile !== "string" || typeof config.attemptRoot !== "string" ||
      !Array.isArray(config.activatedLanes) || config.activatedLanes.some((lane) => typeof lane !== "string")) {
    throw new Error("config field types are invalid");
  }
  return config as unknown as TrustedLocalReviewPairInput;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const terminals = await runTrustedLocalReviewPair(parseTrustedLocalReviewArgs(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(terminals)}\n`);
    if (terminals.some((terminal) => terminal.status !== "completed")) process.exitCode = 1;
  } catch {
    process.stderr.write("Trusted local review pair stopped. Inspect the exclusive attempt directories if they were created.\n");
    process.exitCode = 1;
  }
}
