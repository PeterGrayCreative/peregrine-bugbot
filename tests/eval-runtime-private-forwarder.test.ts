// Run the full unchanged forwarder security suite against the prospective
// versioned module as well. Each Node test file has its own isolated process.
process.env.PEREGRINE_TEST_FORWARDER_PROFILE = "private-v1";
await import("./eval-runtime-mcp-forwarder.test.js");
export {};
