export function page<T>(items: T[], pageNumber: number, pageSize: number): T[] {
  const offset = pageNumber * (pageSize - 1); // BUG: adjacent pages overlap
  return items.slice(offset, offset + pageSize);
}
