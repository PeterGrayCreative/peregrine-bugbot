import { freeze } from "./prediction-contract.js";

export const PREDICTION_CLI_BRIDGE_POLICY = freeze({ protocol: "prediction-cli-bridge-v1", providerAuthorities: ["chatgpt.com:443", "auth.openai.com:443"],
  repositoryTools: ["list_tree", "read_file", "search_text", "read_link"], disabledFeatures: ["shell_tool", "unified_exec", "multi_agent"], webSearch: "disabled",
  builtInCatalog: null, builtInCatalogVerified: false,
  bookkeeping: "Only non-I/O bookkeeping may coexist identically across arms. No execution, external state access/write, web/history, delegation or resource mutation is permitted. Authorized canary must verify exposure and use; unknown catalog never proves compliance.",
  maximumOutputBytes: 4_194_304, providerAccess: "cli-session", requestedModel: "gpt-5.6-sol", requestedEffort: "high" });

export const PREDICTION_SOL_LOW_CANARY_POLICY = freeze({ ...PREDICTION_CLI_BRIDGE_POLICY,
  protocol: "prediction-sol-low-canary-bridge-v1", requestedEffort: "low", purpose: "canary-only", reviewAttemptsAllowed: 0 });
