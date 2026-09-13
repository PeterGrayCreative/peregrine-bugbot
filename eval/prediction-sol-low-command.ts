import { same } from "./prediction-contract.js";
import { predictionCliCommand } from "./prediction-cli-command.js";

/** Narrow prospective canary route; never a low-reasoning review profile. */
export function predictionSolLowCanaryCommand(url: string): string[] {
  return predictionCliCommand(url, false).map(arg => arg === 'model_reasoning_effort="high"' ? 'model_reasoning_effort="low"' : arg);
}
export function validatePredictionSolLowCanaryCommand(args: readonly string[], url: string): void {
  same(args, predictionSolLowCanaryCommand(url), "prediction canary command differs from exact Sol/low canary-only profile");
}
