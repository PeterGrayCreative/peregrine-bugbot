export interface FilteredDiff {
  text: string;
  ignoredFiles: string[];
  lineCount: number;
}

export function filterDiff(diff: string, ignorePatterns: string[]): FilteredDiff {
  const parts = diff.split(/(?=^diff --git )/m);
  const ignoredFiles: string[] = [];
  const kept: string[] = [];

  for (const part of parts) {
    if (!part) continue;
    const newPath = part.match(/^\+\+\+ b\/(.+)$/m)?.[1];
    const oldPath = part.match(/^--- a\/(.+)$/m)?.[1];
    const file = newPath ?? oldPath;
    if (file && ignorePatterns.some((pattern) => globMatches(pattern, file))) {
      ignoredFiles.push(file);
      continue;
    }
    kept.push(part);
  }

  const text = kept.join("");
  return {
    text,
    ignoredFiles,
    lineCount: text.length === 0 ? 0 : text.split("\n").length,
  };
}

export function globMatches(glob: string, path: string): boolean {
  let pattern = "^";
  for (let index = 0; index < glob.length; index++) {
    const char = glob[index]!;
    const next = glob[index + 1];
    if (char === "*" && next === "*") {
      if (glob[index + 2] === "/") {
        pattern += "(?:.*/)?";
        index += 2;
      } else {
        pattern += ".*";
        index += 1;
      }
    } else if (char === "*") {
      pattern += "[^/]*";
    } else if (char === "?") {
      pattern += "[^/]";
    } else {
      pattern += char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`${pattern}$`).test(path);
}
