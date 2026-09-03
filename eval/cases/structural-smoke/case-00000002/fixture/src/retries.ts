export function retries(configured: number | undefined): number {
  return configured ?? 3;
}
