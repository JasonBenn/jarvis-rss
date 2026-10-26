// Backlog sweep: classifies every feed in Reader's `feed` location as timeless, topical
// or low, then deletes never-touched documents from topical and low feeds.
// Usage: bun run src/sweep.ts [--dry-run] [--refresh]
import "./instrument";
import * as Sentry from "@sentry/bun";
import Anthropic from "@anthropic-ai/sdk";
import * as fs from "fs";
import * as path from "path";
import {
  MODEL,
  appendLedger,
  feedKey,
  loadFeedClasses,
  readwiseClient,
  untouchableReason,
  type Doc,
  type FeedClass,
  type FeedClasses,
  type Reader,
} from "./filter";

const BATCH_SIZE = 15;
const EPOCH = new Date(0);

export interface FeedSummary {
  key: string;
  site: string | null;
  author: string | null;
  count: number;
  opened: number;
  samples: string[];
}

export type ClassifiedFeeds = Record<string, FeedSummary & { class: FeedClass; reason: string }>;

export function summarizeFeeds(docs: Doc[]): FeedSummary[] {
  const byKey = new Map<string, Doc[]>();
  for (const d of docs) {
    const k = feedKey(d);
    byKey.set(k, [...(byKey.get(k) ?? []), d]);
  }
  return [...byKey.entries()]
    .map(([key, ds]) => ({
      key,
      site: ds[0]!.site_name,
      author: ds[0]!.author,
      count: ds.length,
      opened: ds.filter((d) => d.first_opened_at || d.last_opened_at).length,
      samples: ds
        .sort((a, b) => b.saved_at.localeCompare(a.saved_at))
        .slice(0, 6)
        .map((d) => d.title ?? "(untitled)"),
    }))
    .sort((a, b) => b.count - a.count);
}

/** A sweep deletes only never-touched feed documents whose feed is topical or low. */
export function sweepable(doc: Doc, classes: FeedClasses): boolean {
  if (untouchableReason(doc, EPOCH)) return false;
  const c = classes[feedKey(doc)]?.class;
  return c === "topical" || c === "low";
}

async function classify(client: Anthropic, feeds: FeedSummary[]): Promise<{ class: FeedClass; reason: string }[]> {
  const items = feeds.map((f, i) => ({ i, site: f.site, author: f.author, key: f.key, items: f.count, opened: f.opened, samples: f.samples }));
  const prompt = `Classify each feed in Jason's RSS reader by whether its old, unread posts are safe to delete.

- timeless: essays, ideas, books, talks, contemplative or philosophical writing that read the same in five years.
- topical: current events, news, politics, markets, product updates, AI release coverage, newsletters whose value expires.
- low: thin or noisy: clips, comedy sketches, music, promos, shorts, entertainment.

When a feed mixes both, choose timeless if a meaningful share of its samples would still be worth reading in five years.

Feeds:
${JSON.stringify(items, null, 1)}

Reply with only a JSON array, one object per feed in order: [{"i": 0, "class": "topical", "reason": "about ten words"}, ...]`;
  const res = await client.messages.create({ model: MODEL, max_tokens: 4096, messages: [{ role: "user", content: prompt }] });
  const text = res.content.map((c) => (c.type === "text" ? c.text : "")).join("");
  const arr = JSON.parse(text.match(/\[[\s\S]*\]/)?.[0] ?? "null") as { i: number; class: FeedClass; reason: string }[];
  return feeds.map((_, i) => {
    const r = arr?.find((x) => x.i === i);
    if (!r || !["timeless", "topical", "low"].includes(r.class)) throw new Error(`No valid class for feed ${i}`);
    return { class: r.class, reason: r.reason };
  });
}

async function deleteAll(reader: Reader, docs: Doc[], listedAt: string, ledgerPath: string) {
  for (let i = 0; i < docs.length; i += 100) {
    // Drop anything that changed since the listing (opened, tagged, moved) before deleting it.
    const changed = new Set((await reader.list({ location: "feed", updatedAfter: listedAt })).map((d) => d.id));
    for (const d of docs.slice(i, i + 100)) {
      if (changed.has(d.id)) continue;
      appendLedger(ledgerPath, {
        ts: new Date().toISOString(),
        id: d.id,
        url: d.source_url,
        title: d.title,
        site: d.site_name,
        author: d.author,
        score: null,
        why: `sweep: ${feedKey(d)}`,
        decision: "drop",
        action: "sweep-delete",
        model: null,
      });
      await reader.delete(d.id);
    }
    console.log(`${new Date().toISOString()} deleted through ${Math.min(i + 100, docs.length)}/${docs.length}`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const token = process.env.READWISE_TOKEN;
  if (!token) throw new Error("READWISE_TOKEN not set");
  const root = path.join(import.meta.dir, "..");
  const backlogPath = path.join(root, "data/feed-backlog.json");
  const classesPath = path.join(root, "data/feed-classes.json");
  const reader = readwiseClient(token);

  // The real sweep always lists fresh; a dry run reuses the cached listing.
  let backlog: { listedAt: string; docs: Doc[] };
  if (fs.existsSync(backlogPath) && dryRun && !args.includes("--refresh")) {
    backlog = JSON.parse(fs.readFileSync(backlogPath, "utf8"));
  } else {
    const listedAt = new Date().toISOString();
    backlog = { listedAt, docs: await reader.list({ location: "feed" }) };
    fs.mkdirSync(path.dirname(backlogPath), { recursive: true });
    fs.writeFileSync(backlogPath, JSON.stringify(backlog));
  }

  const feeds = summarizeFeeds(backlog.docs);
  const classes = loadFeedClasses(classesPath) as ClassifiedFeeds;
  const todo = feeds.filter((f) => !classes[f.key]);
  const client = new Anthropic();
  for (let i = 0; i < todo.length; i += BATCH_SIZE) {
    const batch = todo.slice(i, i + BATCH_SIZE);
    const results = await classify(client, batch);
    batch.forEach((f, k) => (classes[f.key] = { ...f, ...results[k]! }));
    fs.writeFileSync(classesPath, JSON.stringify(classes, null, 1));
  }
  // Refresh counts and samples for feeds classified on an earlier run.
  for (const f of feeds) classes[f.key] = { ...classes[f.key]!, ...f };
  fs.writeFileSync(classesPath, JSON.stringify(classes, null, 1));

  const doomed = backlog.docs.filter((d) => sweepable(d, classes));
  const byClass: Record<string, { feeds: number; docs: number }> = {};
  for (const f of feeds) {
    const c = (byClass[classes[f.key]!.class] ??= { feeds: 0, docs: 0 });
    c.feeds++;
    c.docs += f.count;
  }
  const pct = ((100 * doomed.length) / Math.max(1, backlog.docs.length)).toFixed(1);
  console.log(`Feed docs: ${backlog.docs.length} (listed ${backlog.listedAt}), feeds: ${feeds.length}`);
  for (const [c, v] of Object.entries(byClass)) console.log(`  ${c}: ${v.feeds} feeds, ${v.docs} docs`);
  console.log(`${dryRun ? "Projected deletions" : "Deleting"}: ${doomed.length} (${pct}% of the backlog)`);
  console.log("Largest feeds:");
  for (const f of feeds.slice(0, 20)) {
    const c = classes[f.key]!;
    console.log(`  ${String(f.count).padStart(5)}  ${c.class.padEnd(8)} ${f.key}  — ${c.reason}`);
  }

  if (!dryRun) await deleteAll(reader, doomed, backlog.listedAt, path.join(root, "data/filter-ledger.jsonl"));
}

if (import.meta.main) {
  main().catch(async (err) => {
    console.error(err);
    Sentry.captureException(err);
    await Sentry.flush(2000);
    process.exit(1);
  });
}
