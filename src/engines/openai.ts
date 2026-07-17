import type { EngineResult, ReviewContext } from "../types.js";
import type { Engine } from "./engine.js";

/**
 * OpenAI engine — intentionally a stub. To wire it up:
 *
 *  1. Port the two-tier prompt flow: a cheap breadth pass (e.g. a mini model)
 *     over the diff producing candidate areas, then a deep pass with a strong
 *     model + repo tools (the codex CLI's headless mode, or the Responses API
 *     with your own tool loop).
 *  2. Emit the same Finding[] shape and fill usage.costUsd from the API's
 *     token counts x a pricing table — the eval harness compares engines
 *     purely on EngineResult, so cost parity matters.
 *  3. Register nothing else: engine.ts already routes "openai" here.
 *
 * Everything downstream (posting, dedupe, eval matrix, grading, reports)
 * works unchanged once review() returns a real EngineResult.
 */
export const openaiEngine: Engine = {
  name: "openai",
  async review(_ctx: ReviewContext): Promise<EngineResult> {
    throw new Error(
      "openai engine not implemented yet — see src/engines/openai.ts for the wiring guide.",
    );
  },
};
