export interface CatalogItem {
  sku: string;
  title: string;
  active: boolean;
  unitOfMeasure: "each" | "case" | "kilogram";
  caseSize: number | null;
  tags: string[];
}

export function validateCatalogItem(item: CatalogItem): void {
  if (!/^[A-Z0-9][A-Z0-9_-]{2,31}$/.test(item.sku)) throw new Error("invalid catalog sku");
  if (!item.title.trim()) throw new Error("catalog title is required");
  if (item.unitOfMeasure === "case") {
    if (!Number.isSafeInteger(item.caseSize) || (item.caseSize ?? 0) <= 1) throw new Error("case item needs a case size");
  } else if (item.caseSize !== null) throw new Error("case size is only valid for case units");
  if (new Set(item.tags).size !== item.tags.length) throw new Error("catalog tags must be unique");
}

export function indexCatalog(items: CatalogItem[]): Map<string, CatalogItem> {
  const indexed = new Map<string, CatalogItem>();
  for (const item of items) {
    validateCatalogItem(item);
    if (indexed.has(item.sku)) throw new Error(`duplicate catalog sku: ${item.sku}`);
    indexed.set(item.sku, structuredClone(item));
  }
  return indexed;
}

export function activeCatalogItems(items: CatalogItem[]): CatalogItem[] {
  return items.filter((item) => item.active).map((item) => structuredClone(item)).sort((left, right) => left.sku.localeCompare(right.sku));
}

export function itemsWithTag(items: CatalogItem[], tag: string): CatalogItem[] {
  return activeCatalogItems(items).filter((item) => item.tags.includes(tag));
}

export function unitsPerPackage(item: CatalogItem): number {
  validateCatalogItem(item);
  return item.unitOfMeasure === "case" ? item.caseSize! : 1;
}
