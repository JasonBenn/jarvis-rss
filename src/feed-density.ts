// Feed density: how much of what each feed sends Jason ends up liked, and how much is stubs.
// Reads data/feed-backlog.json (the feed location as of the 10-27 sweep), data/reader-snapshot.json
// and data/eval-set.jsonl (from eval-set.ts), data/filter-ledger.jsonl and data/feed-classes.json.
// Usage: bun run src/feed-density.ts [--json]
import * as fs from "fs";
import * as path from "path";
import { feedKey, loadFeedClasses, type Doc, type LedgerEntry } from "./filter";
import type { EvalRow, ReaderDoc } from "./eval-set";
import { readJsonl } from "./eval";

// Paywalled by design: the RSS item is a teaser and the enricher adds an archive.today link.
export const ENRICHED = new Set(["foreignaffairs.com", "economist.com"]);
const LEDGER_SINCE = "2026-10-27";
const STUB_WORDS = 300;

export interface FeedStats {
  feed: string;
  cls: string;
  arrivals: number; // every feed doc seen: backlog, current Reader, and ledger since 10-27
  recent: number; // ledger arrivals judged since 10-27
  keeps: number;
  openedKeeps: number;
  opened: number;
  strongLikes: number;
  likes: number;
  dislikes: number;
  weakDislikes: number;
  stubRate: number | null; // share of text arrivals under 300 words; null for video feeds
  density: number; // (strong likes + likes) / arrivals
}

export function feedStats(backlog: Doc[], current: ReaderDoc[], ledger: LedgerEntry[], evalRows: EvalRow[], classes: Record<string, { class: string }>): FeedStats[] {
  const docs = new Map<string, ReaderDoc>();
  const fromFeed = (d: Doc) => d.source === "Reader RSS" && !d.parent_id;
  for (const d of backlog as ReaderDoc[]) if (fromFeed(d)) docs.set(d.id, d);
  for (const d of current) if (fromFeed(d)) docs.set(d.id, d);
  const stats = new Map<string, FeedStats>();
  const get = (feed: string) => {
    let s = stats.get(feed);
    if (!s) {
      s = { feed, cls: classes[feed]?.class ?? "-", arrivals: 0, recent: 0, keeps: 0, openedKeeps: 0, opened: 0, strongLikes: 0, likes: 0, dislikes: 0, weakDislikes: 0, stubRate: null, density: 0 };
      stats.set(feed, s);
    }
    return s;
  };
  const words = new Map<string, number[]>();
  for (const d of docs.values()) {
    const s = get(feedKey(d));
    s.arrivals++;
    if (d.first_opened_at || d.last_opened_at) s.opened++;
    if (d.word_count != null) words.set(s.feed, [...(words.get(s.feed) ?? []), d.word_count]);
  }
  for (const e of ledger) {
    if (!["keep", "delete"].includes(e.action) || e.ts < LEDGER_SINCE) continue;
    const s = get(feedKey({ source_url: e.url, site_name: e.site, author: e.author } as Doc));
    s.recent++;
    if (!docs.has(e.id)) s.arrivals++; // deleted before any snapshot saw it
    if (e.action === "keep") {
      s.keeps++;
      const d = docs.get(e.id);
      if (d && (d.first_opened_at || d.last_opened_at)) s.openedKeeps++;
    }
  }
  for (const r of evalRows) {
    if (r.source !== "Reader RSS") continue; // hand saves and picks say nothing about the feed
    const s = get(r.feed);
    if (r.label === "strong_like") s.strongLikes++;
    if (r.label === "like") s.likes++;
    if (r.label === "dislike") s.dislikes++;
    if (r.label === "weak_dislike") s.weakDislikes++;
  }
  for (const s of stats.values()) {
    const ws = words.get(s.feed) ?? [];
    if (ws.length && !ENRICHED.has(s.feed)) s.stubRate = ws.filter((w) => w < STUB_WORDS).length / ws.length;
    if (ENRICHED.has(s.feed)) s.stubRate = 0;
    s.density = s.arrivals ? (s.strongLikes + s.likes) / s.arrivals : 0;
  }
  return [...stats.values()].sort((a, b) => b.arrivals - a.arrivals);
}

if (import.meta.main) {
  const root = path.join(import.meta.dir, "..");
  const data = (f: string) => path.join(root, "data", f);
  const backlog: { docs: Doc[] } = JSON.parse(fs.readFileSync(data("feed-backlog.json"), "utf8"));
  const snap: { docs: ReaderDoc[] } = JSON.parse(fs.readFileSync(data("reader-snapshot.json"), "utf8"));
  const rows = feedStats(backlog.docs, snap.docs, readJsonl<LedgerEntry>(data("filter-ledger.jsonl")), readJsonl<EvalRow>(data("eval-set.jsonl")), loadFeedClasses(data("feed-classes.json")));
  if (process.argv.includes("--json")) console.log(JSON.stringify(rows));
  else {
    console.log("feed\tclass\tarrivals\trecent\tkeeps\topenedKeeps\topened\tstrong\tlike\tdislike\tweak\tstub\tdensity");
    for (const s of rows) console.log([s.feed, s.cls, s.arrivals, s.recent, s.keeps, s.openedKeeps, s.opened, s.strongLikes, s.likes, s.dislikes, s.weakDislikes, s.stubRate == null ? "-" : s.stubRate.toFixed(2), s.density.toFixed(3)].join("\t"));
  }
}
