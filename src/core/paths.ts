import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

let cachedRoot: string | undefined;

export function packageRoot(): string {
  if (cachedRoot) return cachedRoot;
  let current = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    if (existsSync(join(current, "package.json")) && existsSync(join(current, "skills"))) {
      cachedRoot = current;
      return current;
    }
    const parent = dirname(current);
    if (parent === current) {
      throw new Error("Unable to locate the Peregrine package root");
    }
    current = parent;
  }
}

export function bundledSkillDir(skillName: string): string {
  const path = join(packageRoot(), "skills", skillName);
  if (!existsSync(join(path, "SKILL.md"))) {
    throw new Error(`Bundled skill "${skillName}" is missing at ${path}`);
  }
  return path;
}

export type SchemaName =
  | "review-result"
  | "breadth-result"
  | "breadth-result-compact"
  | "judge-result";

export function schemaPath(name: SchemaName): string {
  const path = join(packageRoot(), "schemas", `${name}.schema.json`);
  if (!existsSync(path)) throw new Error(`Peregrine schema is missing at ${path}`);
  return path;
}

/** Claude structured output accepts the schema vocabulary but not the dialect URI field. */
export function claudeSchemaJson(name: SchemaName): string {
  const schema = JSON.parse(readFileSync(schemaPath(name), "utf8")) as Record<string, unknown>;
  delete schema.$schema;
  return JSON.stringify(schema);
}
