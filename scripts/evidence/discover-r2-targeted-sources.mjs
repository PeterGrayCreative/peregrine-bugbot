import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { capturePages, digest } from "./public-capture-store.mjs";

const root = resolve("docs/validation/artifacts/2026-09-05-r2-candidate-inventory");
const bytes = readFileSync(join(root, "targeted-discovery-protocol-v2.json"));
const protocol = JSON.parse(bytes);
const repos = JSON.parse(readFileSync(join(root, protocol.repositoryProtocol))).repositories;
const frames = [];
function queryPages(repository, query, window) {
  const q = `repo:${repository} ${query.replace(protocol.window, window)}`;
  const pages = capturePages(join(root, "raw"), "search/issues", { q, sort: "created", order: "asc" });
  const items = pages.flatMap((page) => page.value.items);
  if (items.length !== pages[0].value.total_count || new Set(items.map((item) => item.id)).size !== items.length) {
    throw new Error("search total-count or duplicate mismatch; preserve and investigate");
  }
  return pages;
}
for (const { repository, family } of repos) {
  for (const [stratum, query] of [["review-thread-lead", protocol.reviewQuery], ["post-merge-lead", protocol.postMergeQuery]]) {
    let pages;
    try {
      pages = queryPages(repository, query, protocol.window);
    } catch (error) {
      if (!String(error.message).includes("search is incomplete")) throw error;
      pages = [];
      for (const year of [2017, 2018, 2019, 2020]) {
        try {
          pages.push(...queryPages(repository, query, `${year}-01-01..${year}-12-31`));
        } catch (yearError) {
          if (!String(yearError.message).includes("search is incomplete")) throw yearError;
          for (let month = 1; month <= 12; month++) {
            const mm = String(month).padStart(2, "0");
            const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
            pages.push(...queryPages(repository, query, `${year}-${mm}-01..${year}-${mm}-${last}`));
          }
        }
      }
    }
    const items = pages.flatMap((page) => page.value.items);
    if (new Set(items.map((item) => item.id)).size !== items.length) throw new Error("duplicate search result; pagination needs review");
    frames.push({ repository, family, stratum, requests: pages.map((page) => page.receipt),
      leads: items.map((item) => ({ number: item.number, url: item.html_url, title: item.title,
        createdAt: item.created_at, updatedAt: item.updated_at, authorType: item.user?.type ?? "unknown",
        authorLogin: item.user?.login ?? null, labels: item.labels.map((label) => label.name),
        inventoryStatus: "not-selected", truthStatus: "unknown" })) });
    console.log(`${repository} ${stratum}: ${items.length} discovery leads`);
  }
}
const target = join(root, "targeted-discovery-v2.json");
const result = `${JSON.stringify({ schemaVersion: 1, protocolSha256: digest(bytes), admittedCases: 0, frames }, null, 2)}\n`;
if (existsSync(target)) {
  if (readFileSync(target, "utf8") !== result) throw new Error("immutable discovery conflict");
} else writeFileSync(target, result, { flag: "wx" });
