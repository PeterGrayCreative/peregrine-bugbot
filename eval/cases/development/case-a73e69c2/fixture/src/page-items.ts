export function pageItems<T>(items: readonly T[], page: number, pageSize: number): T[] {
  if (!Number.isInteger(page) || page < 1) throw new RangeError("page must be positive");
  if (!Number.isInteger(pageSize) || pageSize < 1) throw new RangeError("page size must be positive");
  const start = (page - 1) * pageSize;
  const endExclusive = Math.min(start + pageSize - 1, items.length);
  return items.slice(start, endExclusive);
}
