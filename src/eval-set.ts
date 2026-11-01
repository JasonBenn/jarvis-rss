// Engagement eval set: labels Reader documents by how Jason engaged with them, so the
// filter's judge can be measured against what he actually liked and abandoned.
// Usage: bun run src/eval-set.ts [--summary] [--cached]
//   --cached reuses data/reader-snapshot.json instead of re-listing Reader (reads only, never writes).
import * as fs from "fs";
import * as path from "path";
import { feedKey, readwiseClient, type Doc, type LedgerEntry } from "./filter";

export type Label = "strong_like" | "like" | "weak_dislike" | "dislike";

export interface ReaderDoc extends Doc {
  word_count: number | null;
  last_moved_at: string | null;
}

export interface EvalRow {
  id: string;
  url: string | null;
  title: string | null;
  site_name: string | null;
  source: string | null;
  feed: string;
  word_count: number | null;
  summary: string | null;
  author: string | null;
  label: Label;
  reason: string;
  metrics: {
    location: string | null;
    reading_progress: number;
    highlights: number;
    highlight_notes: number;
    tags: string[];
    saved_at: string;
    last_opened_at: string | null;
    last_moved_at: string | null;
    hand_saved: boolean;
    filter_keep: boolean;
  };
  labeled_at: string;
}

const DAY = 24 * 3600 * 1000;
const LEAD_TAGS = ["pick", "far"];

// Hand saves come from share sheets, the web highlighter, in-app link saves and old
// imports; feed and newsletter arrivals have source "Reader RSS" or null, and the lead's
// picks come in through the API.
export function isHand(doc: ReaderDoc): boolean {
  return !!doc.source && !["Reader RSS", "api"].includes(doc.source);
}

/** Why a doc is out of the eval set, or null if it can be labeled. */
export function exclusion(doc: ReaderDoc, now: Date): string | null {
  if (doc.parent_id || ["highlight", "note"].includes(doc.category ?? "")) return "highlight";
  if (doc.category === "email" || doc.source_url?.startsWith("mailto:")) return "email newsletter";
  if (["video", "podcast"].includes(doc.category ?? "") || feedKey(doc).startsWith("youtube:")) return "video or podcast";
  if (/youtube\.com|youtu\.be|spotify\.com|podcasts\.apple\.com/.test(doc.source_url ?? "")) return "video or podcast";
  if (doc.category === "epub") return "book";
  if (/^private:|chatgpt\.com\/share|claude\.ai\/share/.test(doc.source_url ?? "")) return "own upload or AI chat";
  if ((doc.word_count ?? 0) < 300) return "under 300 words";
  if (now.getTime() - new Date(doc.saved_at).getTime() < 3 * DAY) return "saved in the last 3 days";
  return null;
}

export interface Engagement {
  highlights: number;
  highlightNotes: number;
}

/** The label and the rule that fired, or null when no rule applies. Rules are checked strongest first. */
export function label(doc: ReaderDoc, eng: Engagement, now: Date): { label: Label; reason: string } | null {
  const progress = doc.reading_progress ?? 0;
  const opened = !!(doc.first_opened_at || doc.last_opened_at) || progress > 0;
  const tags = Object.keys(doc.tags ?? {});
  const ownTags = tags.filter((t) => !LEAD_TAGS.includes(t));
  const hasNote = !!doc.notes?.trim();

  if (eng.highlights > 0 || hasNote) {
    const what = [eng.highlights && `${eng.highlights} highlights`, eng.highlightNotes && `${eng.highlightNotes} highlight notes`, hasNote && "doc note"];
    return { label: "strong_like", reason: `engaged: ${what.filter(Boolean).join(", ")}` };
  }
  // Reader keeps no move history; a doc sitting in `later` (or archived out of the
  // inbox after being moved there) that he read through is the closest observable proxy.
  if (doc.location === "later" && progress >= 0.9) return { label: "strong_like", reason: `in later and read to ${pct(progress)}` };
  if (isHand(doc) && progress >= 0.9 && (doc.word_count ?? 0) >= 800) {
    return { label: "like", reason: `hand-saved (${doc.source}), read to ${pct(progress)}, ${doc.word_count} words` };
  }
  // Unopened is never a label: he does not aim to read everything that arrives, so an
  // untouched doc (a filter keep or the lead's pick included) says nothing about his taste.
  if (!opened) return null;
  const stale = !doc.last_opened_at || now.getTime() - new Date(doc.last_opened_at).getTime() > 3 * DAY;
  if (progress >= 0.05 && progress <= 0.6 && stale && ownTags.length === 0) {
    return { label: "dislike", reason: `abandoned at ${pct(progress)}, last opened ${doc.last_opened_at?.slice(0, 10) ?? "?"}` };
  }
  if (progress >= 0.9 && ownTags.length === 0) {
    return { label: "weak_dislike", reason: `read to ${pct(progress)} with no highlight, note or tag` };
  }
  return null;
}

const pct = (p: number) => `${Math.round(p * 100)}%`;

export function buildRows(docs: ReaderDoc[], highlights: ReaderDoc[], filterKeeps: Set<string>, now: Date): EvalRow[] {
  const eng = new Map<string, Engagement>();
  for (const h of highlights) {
    if (!h.parent_id) continue;
    const e = eng.get(h.parent_id) ?? { highlights: 0, highlightNotes: 0 };
    e.highlights++;
    if (h.notes?.trim()) e.highlightNotes++;
    eng.set(h.parent_id, e);
  }
  const rows: EvalRow[] = [];
  for (const d of docs) {
    if (exclusion(d, now)) continue;
    const e = eng.get(d.id) ?? { highlights: 0, highlightNotes: 0 };
    const l = label(d, e, now);
    if (!l) continue;
    rows.push({
      id: d.id,
      url: d.source_url,
      title: d.title,
      site_name: d.site_name,
      source: d.source,
      feed: feedKey(d),
      word_count: d.word_count,
      summary: d.summary,
      author: d.author,
      ...l,
      metrics: {
        location: d.location,
        reading_progress: d.reading_progress ?? 0,
        highlights: e.highlights,
        highlight_notes: e.highlightNotes,
        tags: Object.keys(d.tags ?? {}),
        saved_at: d.saved_at,
        last_opened_at: d.last_opened_at,
        last_moved_at: d.last_moved_at,
        hand_saved: isHand(d),
        filter_keep: filterKeeps.has(d.id),
      },
      labeled_at: now.toISOString(),
    });
  }
  return rows.sort((a, b) => a.id.localeCompare(b.id));
}

export function readFilterKeeps(ledgerPath: string): Set<string> {
  const ids = new Set<string>();
  if (!fs.existsSync(ledgerPath)) return ids;
  for (const l of fs.readFileSync(ledgerPath, "utf8").split("\n")) {
    if (l.includes('"action":"keep"')) ids.add((JSON.parse(l) as LedgerEntry).id);
  }
  return ids;
}

export function summarize(rows: EvalRow[]): string {
  const out: string[] = [];
  const count = (key: (r: EvalRow) => string) => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(key(r), (m.get(key(r)) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  };
  out.push(`${rows.length} labeled docs`);
  for (const [k, n] of count((r) => r.label)) out.push(`  ${k.padEnd(14)} ${n}`);
  out.push("\nBy feed (top 40):");
  const byFeed = new Map<string, Record<string, number>>();
  for (const r of rows) {
    const f = byFeed.get(r.feed) ?? {};
    f[r.label] = (f[r.label] ?? 0) + 1;
    byFeed.set(r.feed, f);
  }
  const ranked = [...byFeed.entries()].sort((a, b) => sum(b[1]) - sum(a[1])).slice(0, 40);
  for (const [feed, f] of ranked) {
    out.push(`  ${feed.padEnd(36)} ${Object.entries(f).map(([k, n]) => `${k}=${n}`).join(" ")}`);
  }
  return out.join("\n");
}

const sum = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);

async function main() {
  const args = process.argv.slice(2);
  const root = path.join(import.meta.dir, "..");
  const snapshotPath = path.join(root, "data/reader-snapshot.json");
  const outPath = path.join(root, "data/eval-set.jsonl");
  const ledgerPath = process.env.LEDGER_PATH ?? path.join(root, "data/filter-ledger.jsonl");

  let snap: { listedAt: string; docs: ReaderDoc[]; highlights: ReaderDoc[] };
  if (args.includes("--cached") && fs.existsSync(snapshotPath)) {
    snap = JSON.parse(fs.readFileSync(snapshotPath, "utf8"));
  } else {
    const token = process.env.READWISE_TOKEN;
    if (!token) throw new Error("READWISE_TOKEN not set");
    const reader = readwiseClient(token);
    const docs: ReaderDoc[] = [];
    for (const location of ["new", "later", "archive", "feed"]) {
      const got = (await reader.list({ location })) as ReaderDoc[];
      console.error(`${location}: ${got.length}`);
      docs.push(...got);
    }
    const highlights = (await reader.list({ category: "highlight" })) as ReaderDoc[];
    console.error(`highlights: ${highlights.length}`);
    snap = { listedAt: new Date().toISOString(), docs, highlights };
    fs.mkdirSync(path.dirname(snapshotPath), { recursive: true });
    fs.writeFileSync(snapshotPath, JSON.stringify(snap));
  }

  const rows = buildRows(snap.docs, snap.highlights, readFilterKeeps(ledgerPath), new Date(snap.listedAt));
  fs.writeFileSync(outPath, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  console.error(`wrote ${rows.length} rows to ${outPath}`);
  if (args.includes("--summary")) console.log(summarize(rows));
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
