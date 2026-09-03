export function displayNameForInput(value: string | null, cachedValue: string): string {
  return value ?? cachedValue;
}
