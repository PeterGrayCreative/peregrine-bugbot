import type { ReservationReceipt } from "./inventory-types.ts";

export interface ReservationSummary {
  requestId: string;
  lineCount: number;
  totalUnits: number;
  lowestRemainingStock: number;
}

export function summarizeReservation(receipt: ReservationReceipt): ReservationSummary {
  if (receipt.lines.length === 0) throw new Error("reservation receipt has no lines");
  return {
    requestId: receipt.requestId,
    lineCount: receipt.lines.length,
    totalUnits: receipt.lines.reduce((sum, line) => sum + line.quantity, 0),
    lowestRemainingStock: Math.min(...receipt.lines.map((line) => line.remainingAvailable)),
  };
}

export function formatReservationSummary(summary: ReservationSummary): string {
  return [
    `request=${summary.requestId}`,
    `lines=${summary.lineCount}`,
    `units=${summary.totalUnits}`,
    `lowestRemaining=${summary.lowestRemainingStock}`,
  ].join(" ");
}

export function combineSummaries(summaries: ReservationSummary[]): ReservationSummary {
  if (summaries.length === 0) throw new Error("at least one summary is required");
  return {
    requestId: summaries.map((summary) => summary.requestId).join("+"),
    lineCount: summaries.reduce((sum, summary) => sum + summary.lineCount, 0),
    totalUnits: summaries.reduce((sum, summary) => sum + summary.totalUnits, 0),
    lowestRemainingStock: Math.min(...summaries.map((summary) => summary.lowestRemainingStock)),
  };
}
