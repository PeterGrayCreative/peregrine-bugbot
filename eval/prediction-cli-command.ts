import { same } from "./prediction-contract.js";

/** Experimental profile only. MCP has exactly four repository capabilities;
 * the pinned client's complete built-in catalog still requires canary evidence. */
export function predictionCliCommand(url: string, review: boolean): string[] {
  const endpoint = new URL(url);
  if (endpoint.origin !== "http://mcp-forwarder:8082" || !/^\/mcp\/[a-f0-9]{64}$/.test(endpoint.pathname) || endpoint.search || endpoint.hash || endpoint.username || endpoint.password) throw new Error("prediction CLI endpoint is not the scoped forwarder");
  return ["exec", "--ephemeral", "--ignore-user-config", "--ignore-rules", "--skip-git-repo-check", "--strict-config",
    "--disable", "shell_tool", "--disable", "unified_exec", "--disable", "multi_agent",
    "--sandbox", "read-only", "--model", "gpt-5.6-sol",
    "--config", 'model_reasoning_effort="high"', "--config", 'web_search="disabled"',
    "--config", "project_doc_max_bytes=0", "--config", "project_doc_fallback_filenames=[]",
    "--config", 'projects."/workspace".trust_level="untrusted"',
    "--config", `mcp_servers.source_read.url=${JSON.stringify(endpoint.href)}`,
    "--config", 'mcp_servers.source_read.enabled_tools=["list_tree","read_file","search_text","read_link"]',
    "--config", "mcp_servers.source_read.required=true", "--cd", "/workspace",
    ...(review ? ["--output-schema", "/opt/peregrine/methodology-review.schema.json"] : []),
    "--output-last-message", "/output/result.json", "--json", "--color", "never", "-"];
}
export function validatePredictionCliCommand(args: readonly string[], url: string): void {
  same(args, predictionCliCommand(url, args.includes("--output-schema")), "prediction CLI command differs from exact Sol/high four-reader profile");
}
