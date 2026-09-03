export interface FulfillmentWindow {
  opensAt: string;
  closesAt: string;
  timezone: string;
}

export function validateFulfillmentWindow(window: FulfillmentWindow): void {
  const opensAt = Date.parse(window.opensAt);
  const closesAt = Date.parse(window.closesAt);
  if (!Number.isFinite(opensAt) || !Number.isFinite(closesAt)) throw new Error("invalid fulfillment window");
  if (closesAt <= opensAt) throw new Error("fulfillment window must close after opening");
  if (!/^[A-Za-z_]+\/[A-Za-z_]+$/.test(window.timezone)) throw new Error("invalid timezone");
}

export function containsInstant(window: FulfillmentWindow, instant: string): boolean {
  validateFulfillmentWindow(window);
  const value = Date.parse(instant);
  return Number.isFinite(value) && value >= Date.parse(window.opensAt) && value < Date.parse(window.closesAt);
}

export function intersectWindows(left: FulfillmentWindow, right: FulfillmentWindow): FulfillmentWindow | null {
  validateFulfillmentWindow(left);
  validateFulfillmentWindow(right);
  const opensAt = Math.max(Date.parse(left.opensAt), Date.parse(right.opensAt));
  const closesAt = Math.min(Date.parse(left.closesAt), Date.parse(right.closesAt));
  if (closesAt <= opensAt) return null;
  return {
    opensAt: new Date(opensAt).toISOString(),
    closesAt: new Date(closesAt).toISOString(),
    timezone: left.timezone,
  };
}
