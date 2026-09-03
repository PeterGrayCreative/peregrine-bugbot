export function windowItems<T>(items: readonly T[], offset: number, limit: number): T[] {
  const lastIndex = Math.min(offset + limit - 1, items.length - 1);
  if (lastIndex < offset) return [];
  return items.slice(offset, lastIndex + 1);
}
