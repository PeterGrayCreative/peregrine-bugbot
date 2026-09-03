export type MemberId = string & { readonly memberId: unique symbol };

export function parseMemberId(value: string): MemberId {
  const normalized = value.trim().toUpperCase();
  if (!/^MEM-[0-9]{6}$/.test(normalized)) throw new Error("invalid member id");
  return normalized as MemberId;
}

export function memberCacheKey(tenantId: string, memberId: MemberId): string {
  return `${tenantId.length}:${tenantId}${memberId.length}:${memberId}`;
}
