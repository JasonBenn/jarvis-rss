// Paywall-stub filter: deletes never-touched feed documents whose RSS body is only the
// free part of a paid post (it ends in "Read more" or a paid-subscriber notice).
// Usage: bun run src/paywall.ts [--dry-run]
import "./instrument";
import * as Sentry from "@sentry/bun";
import * as path from "path";
import { feedKey, readwiseClient, untouchableReason, type Doc } from "./filter";
import { deleteAll } from "./sweep";

const EPOCH = new Date(0);

// Full text arrives another way: Foreign Affairs ships it in RSS, the Economist goes through
// this server's archive.today proxy.
const FULL_TEXT_KEYS = new Set(["foreignaffairs.com", "economist.com", "archive.today"]);

// Matched against the last 300 characters of the body's text.
const TEASER =
  /(\bread more\s*$|this post is for paid subscribers|reserved for paying subscribers|for paid subscribers only|available only to paid subscribers|subscribe to continue reading|keep reading with a \d+-day free trial|become a (free or )?paid subscriber to read the rest|available for free if you are a subscriber)/i;

export function bodyText(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/** Why a document is a paywall stub to delete, or null to leave it alone. */
export function stubReason(doc: Doc & { html_content?: string | null }): string | null {
  if (untouchableReason(doc, EPOCH)) return null;
  if (doc.category !== "rss") return null; // emails, podcasts, videos, PDFs
  const key = feedKey(doc);
  if (key.startsWith("youtube:") || FULL_TEXT_KEYS.has(key)) return null;
  if ((doc.source_url ?? "").includes("rss.jasonbenn.com")) return null;
  const tail = bodyText(doc.html_content ?? "").slice(-300);
  const m = tail.match(TEASER);
  return m ? `paywall: ends "${m[0].trim().slice(0, 60)}"` : null;
}

export function countByFeed(docs: Doc[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const d of docs) out.set(feedKey(d), (out.get(feedKey(d)) ?? 0) + 1);
  return out;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const token = process.env.READWISE_TOKEN;
  if (!token) throw new Error("READWISE_TOKEN not set");
  const reader = readwiseClient(token);

  const listedAt = new Date().toISOString();
  const docs = await reader.list({ location: "feed", page_size: "100", withHtmlContent: "true" });
  const stubs = docs.filter((d) => stubReason(d));
  const total = countByFeed(docs);
  const doomed = countByFeed(stubs);
  console.log(`${listedAt} feed docs: ${docs.length}, paywall stubs: ${stubs.length}${dryRun ? " (dry run)" : ""}`);
  for (const [k, n] of [...doomed].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(4)} / ${String(total.get(k)).padEnd(5)} ${k}`);
  }
  if (!dryRun) {
    const root = path.join(import.meta.dir, "..");
    await deleteAll(reader, stubs, listedAt, path.join(root, "data/filter-ledger.jsonl"), console.log, "paywall", (d) => stubReason(d)!);
  }
  await Sentry.flush(2000);
}

if (import.meta.main) {
  main().catch(async (err) => {
    console.error(err);
    Sentry.captureException(err);
    await Sentry.flush(2000);
    process.exit(1);
  });
}
