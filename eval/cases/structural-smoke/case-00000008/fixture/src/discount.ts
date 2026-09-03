export function effectiveDiscount(configured: number | undefined): number {
  return configured || 10; // BUG: zero is a valid configured value
}
