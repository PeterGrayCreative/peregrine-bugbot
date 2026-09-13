import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { runSolLowOperator } from "../../eval/prediction-sol-low-operator.js";
import { hash } from "../../eval/prediction-contract.js";

export function parseSolLowOperatorArgs(args: string[]) {
  const keys = ["--freeze", "--freeze-sha256", "--gate", "--gate-sha256", "--report-directory"];
  if (args.length !== 11 || !["--preflight", "--authorize-one-canary"].includes(args[10]!)) throw new Error("Expected --freeze FILE --freeze-sha256 SHA --gate FILE --gate-sha256 SHA --report-directory NEW_DIRECTORY (--preflight | --authorize-one-canary)");
  for (let i = 0; i < keys.length; i++) if (args[i * 2] !== keys[i] || !args[i * 2 + 1]) throw new Error("exact one-canary command required; no alternate route, batch or retry flags");
  return { freeze: { bytes: readFileSync(resolve(args[1]!), "utf8"), expectedSha256: hash(args[3]) },
    gate: { bytes: readFileSync(resolve(args[5]!), "utf8"), expectedSha256: hash(args[7]) }, reportDirectory: resolve(args[9]!),
    action: args[10] === "--preflight" ? "preflight" as const : "authorize-one-canary" as const };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { const result = await runSolLowOperator(parseSolLowOperatorArgs(process.argv.slice(2))); process.stdout.write(JSON.stringify(result) + "\n"); }
  catch { process.stderr.write("Sol-low operator stopped; inspect the separate retained evidence report. No retry is authorized.\n"); process.exitCode = 1; }
}
