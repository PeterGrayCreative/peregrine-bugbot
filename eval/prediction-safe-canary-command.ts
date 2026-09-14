import { same } from "./prediction-contract.js";
import { predictionSolLowCanaryCommand } from "./prediction-sol-low-command.js";

export const SAFE_CANARY_MCP_URL = "http://mcp-forwarder:8082/mcp";
/** No endpoint/credential parameter exists. The client cannot receive the
 * upstream forwarding token through this command or any output-file argument. */
export function predictionSafeCanaryCommand() {
  const prior = predictionSolLowCanaryCommand("http://mcp-forwarder:8082/mcp/" + "0".repeat(64));
  return prior.flatMap((value, index) => value === "--output-last-message" ? ["--output-schema", "/opt/peregrine/canary-status.schema.json"]
    : prior[index - 1] === "--output-last-message" ? []
    : value.startsWith("mcp_servers.source_read.url=") ? [`mcp_servers.source_read.url=${JSON.stringify(SAFE_CANARY_MCP_URL)}`] : [value]);
}
export function validatePredictionSafeCanaryCommand(args: readonly string[]) {
  same(args, predictionSafeCanaryCommand(), "safe canary requires exact file-free Sol/low command");
}
