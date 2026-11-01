// Paywall-stub filter: deletes never-touched feed documents whose RSS body is only the
// free part of a paid post: the body ends in "Read more" or a paid-subscriber notice, and the
// publication's public Substack API confirms the post is paid and longer than what Reader holds.
// Usage: bun run src/paywall.ts [--dry-run]
import "./instrument";
import * as Sentry from "@sentry/bun";
import * as path from "path";
import { feedKey, readwiseClient, untouchableReason, type Doc } from "./filter";
import { deleteAll } from "./sweep";

const EPOCH = new Date(0);
// A preview holding this share of the post is readable as it is (interview series often stop
// a few paragraphs from the end).
const READABLE_SHARE = 0.8;

type FeedDoc = Doc & { html_content?: string | null; word_count?: number | null };
export interface Post {
  audience: string;
  wordcount: number;
}

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

/** Why a document looks like a paywall teaser, or null to leave it alone. */
export function stubReason(doc: FeedDoc): string | null {
  if (untouchableReason(doc, EPOCH)) return null;
  if (doc.category !== "rss") return null; // emails, podcasts, videos, PDFs
  const key = feedKey(doc);
  if (key.startsWith("youtube:") || FULL_TEXT_KEYS.has(key)) return null;
  if ((doc.source_url ?? "").includes("rss.jasonbenn.com")) return null;
  const tail = bodyText(doc.html_content ?? "").slice(-300);
  const m = tail.match(TEASER);
  return m ? `paywall: ends "${m[0].trim().slice(0, 60)}"` : null;
}

/** A teaser is deleted only when its post is paid and Reader holds less than most of it. */
export function isPaidStub(doc: FeedDoc, post: Post | null): boolean {
  if (!post || post.audience === "everyone") return false;
  return (doc.word_count ?? 0) < READABLE_SHARE * post.wordcount;
}

// Substack's public post endpoint, on custom domains too. Null when it cannot say.
export async function fetchPost(sourceUrl: string): Promise<Post | null> {
  try {
    const u = new URL(sourceUrl);
    const slug = u.pathname.match(/^\/p\/([^/]+)/)?.[1];
    if (!slug) return null;
    let res = await fetch(`${u.origin}/api/v1/posts/${slug}`, { signal: AbortSignal.timeout(15000) });
    // Substack rate-limits per IP across all its publications.
    for (let attempt = 0; res.status === 429 && attempt < 4; attempt++) {
      await new Promise((r) => setTimeout(r, (Number(res.headers.get("Retry-After")) || 30) * 1000));
      res = await fetch(`${u.origin}/api/v1/posts/${slug}`, { signal: AbortSignal.timeout(15000) });
    }
    if (!res.ok) return null;
    const d: any = await res.json();
    return typeof d.audience === "string" && typeof d.wordcount === "number" ? { audience: d.audience, wordcount: d.wordcount } : null;
  } catch {
    return null;
  }
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
  const stubs: Doc[] = [];
  let unconfirmed = 0;
  for (const d of docs.filter((d) => stubReason(d))) {
    const post = await fetchPost(d.source_url ?? "");
    if (!post) unconfirmed++;
    if (isPaidStub(d, post)) stubs.push(d);
    await new Promise((r) => setTimeout(r, 1000));
  }
  const total = countByFeed(docs);
  const doomed = countByFeed(stubs);
  console.log(`${listedAt} feed docs: ${docs.length}, paywall stubs: ${stubs.length}, teasers left unconfirmed: ${unconfirmed}${dryRun ? " (dry run)" : ""}`);
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
