import type { EngineResult, ReviewContext } from "../types.js";
import { claudeEngine } from "./claude.js";
import { openaiEngine } from "./openai.js";
import { mockEngine } from "./mock.js";

export interface Engine {
  name: string;
  review(ctx: ReviewContext): Promise<EngineResult>;
}

const registry: Record<string, Engine> = {
  claude: claudeEngine,
  openai: openaiEngine,
  mock: mockEngine,
};

export function getEngine(name: string): Engine {
  const engine = registry[name];
  if (!engine) {
    throw new Error(
      `Unknown engine "${name}". Available: ${Object.keys(registry).join(", ")}`,
    );
  }
  return engine;
}
