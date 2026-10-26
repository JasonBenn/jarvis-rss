// Feed filter for Readwise Reader: judges new documents in the `feed` location
// against taste.md, tags keeps `pick` with a one-line why, deletes the rest.
// Usage: bun run src/filter.ts [--dry-run] [--since <iso>]
import "./instrument";
import * as Sentry from "@sentry/bun";
import Anthropic from "@anthropic-ai/sdk";
import * as fs from "fs";
import * as path from "path";

export const MODEL = "claude-sonnet-5-5";
export const KEEP_THRESHOLD = 7;
const BATCH_SIZE = 20;
const API = "https://readwise.io/api/v3";
// The next watermark trails the run start, because a doc's saved_at can precede
// the moment it becomes listable. Overlap is safe: keeps carry a tag and deletes are gone.
const WATERMARK_LAG_MS = 10 * 60 * 1000;

export interface Doc {
  id: string;
  url: string;
  source_url: string | null;
  title: string | null;
  author: string | null;
  site_name: string | null;
  summary: string | null;
  source: string | null;
  category: string | null;
  location: string | null;
  tags: Record<string, unknown> | null;
  notes: string | null;
  parent_id: string | null;
  reading_progress: number | null;
  first_opened_at: string | null;
  last_opened_at: string | null;
  saved_at: string;
  duration_seconds?: number | null;
}

export interface Reader {
  list(params: Record<string, string>): Promise<Doc[]>;
  get(id: string): Promise<Doc | null>;
  update(id: string, body: Record<string, unknown>): Promise<void>;
  delete(id: string): Promise<void>;
}

export interface Judgment {
  score: number;
  why: string;
}

export type Judge = (docs: Doc[], exemplars: Doc[]) => Promise<Judgment[]>;

// --- Safety guards --------------------------------------------------------

/** Returns why a document must not be touched, or null if it is fair game. */
export function untouchableReason(doc: Doc, watermark: Date): string | null {
  if (doc.location !== "feed") return `location ${doc.location}`;
  if (doc.parent_id) return "is a highlight or note";
  if (doc.first_opened_at || doc.last_opened_at) return "opened";
  if ((doc.reading_progress ?? 0) > 0) return "has reading progress";
  if (doc.tags && Object.keys(doc.tags).length > 0) return "tagged";
  if (doc.notes && doc.notes.trim() !== "") return "has notes";
  if (new Date(doc.saved_at) < watermark) return "saved before watermark";
  return null;
}

// Reader exposes no video duration today; duration_seconds is honored if it ever appears.
export function isShort(doc: Doc): boolean {
  const url = doc.source_url ?? "";
  if (/youtube\.com\/shorts\//.test(url)) return true;
  return doc.duration_seconds != null && doc.duration_seconds < 90;
}

// Hand saves: anything not delivered by a feed subscription or email newsletter.
// On real data, feed docs have source "Reader RSS"; newsletters have source null and
// category "email"; hand saves come from "Readwise web highlighter", "Reader Share Sheet
// iOS/Android", "Reader in app link save", "File Upload", and old "pocket"/"instapaper"
// imports (those sort out by saved_at).
export function isHandSaved(doc: Doc): boolean {
  if (!doc.source || doc.source === "Reader RSS") return false;
  if (doc.parent_id || ["email", "highlight", "note"].includes(doc.category ?? "")) return false;
  return doc.location === "new" || doc.location === "later";
}

// Reader's list payload has no feed id. A feed is identified by its YouTube channel
// (site_name "YouTube" + author), else the source_url host; substack.com-hosted posts
// (substack.com/@name, open.substack.com/pub/name) take the publication from the path.
export function feedKey(doc: Doc): string {
  let host = "";
  let parts: string[] = [];
  try {
    const u = new URL(doc.source_url ?? "");
    host = u.hostname.replace(/^www\./, "");
    parts = u.pathname.split("/").filter(Boolean);
  } catch {}
  if (host === "youtube.com" || host === "m.youtube.com" || doc.site_name === "YouTube") {
    return `youtube:${doc.author ?? "?"}`;
  }
  if (host === "open.substack.com" && parts[0] === "pub" && parts[1]) return `${parts[1]}.substack.com`;
  if (host === "substack.com" && parts[0]?.startsWith("@")) return `${parts[0].slice(1)}.substack.com`;
  return host || doc.site_name || doc.author || "?";
}

export type FeedClass = "timeless" | "topical" | "low";
export type FeedClasses = Record<string, { class: FeedClass; reason: string }>;

export function loadFeedClasses(p: string): FeedClasses {
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : {};
}

// --- State and ledger -----------------------------------------------------

export interface LedgerEntry {
  ts: string;
  id: string;
  url: string | null;
  title: string | null;
  site: string | null;
  author: string | null;
  score: number | null;
  why: string;
  decision: "keep" | "drop";
  action: "keep" | "delete" | "dry-run" | "sweep-delete";
  model: string | null;
}

export function appendLedger(ledgerPath: string, entry: LedgerEntry) {
  fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
  const fd = fs.openSync(ledgerPath, "a");
  try {
    fs.writeSync(fd, JSON.stringify(entry) + "\n");
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

function readWatermark(statePath: string): Date | null {
  if (!fs.existsSync(statePath)) return null;
  return new Date(JSON.parse(fs.readFileSync(statePath, "utf8")).watermark);
}

function writeWatermark(statePath: string, watermark: Date) {
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify({ watermark: watermark.toISOString() }) + "\n");
}

// --- Run ------------------------------------------------------------------

export interface RunOptions {
  reader: Reader;
  judge: Judge;
  statePath: string;
  ledgerPath: string;
  feedClasses?: FeedClasses;
  dryRun: boolean;
  since?: Date;
  now?: Date;
  log?: (msg: string) => void;
}

export interface RunResult {
  judged: number;
  kept: number;
  dropped: number;
  skipped: number;
  failedBatches: number;
}

export async function run(opts: RunOptions): Promise<RunResult> {
  const { reader, judge, statePath, ledgerPath, dryRun } = opts;
  const now = opts.now ?? new Date();
  const log = opts.log ?? console.log;
  const result: RunResult = { judged: 0, kept: 0, dropped: 0, skipped: 0, failedBatches: 0 };

  const watermark = opts.since ?? readWatermark(statePath);
  if (!watermark) {
    if (!dryRun) writeWatermark(statePath, now);
    log(`No watermark; initialized to ${now.toISOString()}. Nothing processed.`);
    return result;
  }

  const listed = await reader.list({ location: "feed", updatedAfter: watermark.toISOString() });
  const candidates = listed.filter((d) => {
    const reason = untouchableReason(d, watermark);
    if (reason) result.skipped++;
    return !reason;
  });
  log(`${listed.length} listed, ${candidates.length} candidates since ${watermark.toISOString()}`);

  const act = async (doc: Doc, j: Judgment, model: string | null) => {
    const decision = j.score >= KEEP_THRESHOLD ? "keep" : "drop";
    const action = dryRun ? "dry-run" : decision === "keep" ? "keep" : "delete";
    // Re-read right before writing: Jason may have opened or tagged it since the list call.
    const fresh = dryRun ? doc : await reader.get(doc.id);
    if (!fresh || untouchableReason(fresh, watermark)) {
      result.skipped++;
      return;
    }
    appendLedger(ledgerPath, {
      ts: new Date().toISOString(),
      id: doc.id,
      url: doc.source_url,
      title: doc.title,
      site: doc.site_name,
      author: doc.author,
      score: j.score,
      why: j.why,
      decision,
      action,
      model,
    });
    result.judged++;
    if (decision === "keep") result.kept++;
    else result.dropped++;
    if (action === "keep") await reader.update(doc.id, { tags: ["pick"], summary: j.why.slice(0, 140) });
    if (action === "delete") await reader.delete(doc.id);
  };

  const isLow = (d: Doc) => opts.feedClasses?.[feedKey(d)]?.class === "low";
  for (const doc of candidates.filter(isShort)) await act(doc, { score: 0, why: "YouTube Short" }, null);
  for (const doc of candidates.filter((d) => !isShort(d) && isLow(d))) {
    await act(doc, { score: 0, why: "Low-value feed" }, null);
  }

  const toJudge = candidates.filter((d) => !isShort(d) && !isLow(d));
  if (toJudge.length > 0) {
    const exemplars = await handSavedExemplars(reader);
    for (let i = 0; i < toJudge.length; i += BATCH_SIZE) {
      const batch = toJudge.slice(i, i + BATCH_SIZE);
      let judgments: Judgment[];
      try {
        judgments = await judge(batch, exemplars);
      } catch (err) {
        // A failed batch stays in the feed; the watermark holds so the next run retries it.
        result.failedBatches++;
        Sentry.captureException(err);
        log(`Batch ${i / BATCH_SIZE} failed, left in feed: ${err}`);
        continue;
      }
      for (let k = 0; k < batch.length; k++) await act(batch[k]!, judgments[k]!, MODEL);
    }
  }

  if (!dryRun && result.failedBatches === 0) {
    writeWatermark(statePath, new Date(now.getTime() - WATERMARK_LAG_MS));
  }
  return result;
}

export async function handSavedExemplars(reader: Reader, n = 40): Promise<Doc[]> {
  const docs = [
    ...(await reader.list({ location: "new", limit: "100", single: "1" })),
    ...(await reader.list({ location: "later", limit: "100", single: "1" })),
  ];
  return docs
    .filter(isHandSaved)
    .sort((a, b) => b.saved_at.localeCompare(a.saved_at))
    .slice(0, n);
}

// --- Readwise client ------------------------------------------------------

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function readwiseClient(token: string): Reader {
  let last = 0;
  const request = async (method: string, url: string, body?: unknown): Promise<Response> => {
    for (let attempt = 0; ; attempt++) {
      // 20 req/min is the tightest per-endpoint limit; space every call to stay under it.
      const wait = last + 3100 - Date.now();
      if (wait > 0) await sleep(wait);
      last = Date.now();
      const res = await fetch(url, {
        method,
        headers: { Authorization: `Token ${token}`, "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (res.status === 429 && attempt < 5) {
        await sleep((Number(res.headers.get("Retry-After")) || 60) * 1000);
        continue;
      }
      if (!res.ok) throw new Error(`${method} ${url}: ${res.status} ${await res.text()}`);
      return res;
    }
  };

  return {
    async list(params) {
      const { single, ...query } = params;
      const docs: Doc[] = [];
      let cursor: string | null = null;
      do {
        const q = new URLSearchParams(query);
        if (cursor) q.set("pageCursor", cursor);
        const data: any = await (await request("GET", `${API}/list/?${q}`)).json();
        docs.push(...data.results);
        cursor = single ? null : data.nextPageCursor;
      } while (cursor);
      return docs;
    },
    async get(id) {
      const data: any = await (await request("GET", `${API}/list/?id=${id}`)).json();
      return data.results[0] ?? null;
    },
    async update(id, body) {
      await request("PATCH", `${API}/update/${id}/`, body);
    },
    async delete(id) {
      await request("DELETE", `${API}/delete/${id}/`);
    },
  };
}

// --- Model judge ----------------------------------------------------------

const line = (d: Doc) => `${d.title ?? "(untitled)"} — ${d.site_name ?? d.author ?? "?"}`;

export function claudeJudge(client: Anthropic, taste: string): Judge {
  return async (docs, exemplars) => {
    const items = docs.map((d, i) => ({
      i,
      title: d.title,
      site: d.site_name,
      author: d.author,
      url: d.source_url,
      blurb: (d.summary ?? "").slice(0, 500),
    }));
    const system = `You filter Jason's RSS feed. Here is his taste:\n\n${taste}\n\nThings he recently chose himself (title — site), the strongest signal of what he wants:\n${exemplars.map((d) => `- ${line(d)}`).join("\n")}`;
    const prompt = `Score each item 0-10 for whether Jason should read it, following the scoring guide. Scores of 7+ are kept. Calibrate so that roughly the best 1 in 10 items reach 7: in a batch of 20, usually about 2 items score 7+, more on a rich batch. Score relative to the batch: its strongest non-news essay or talk touching his questions even loosely is a 7, unless every item is news, promo or noise. A short blurb, a familiar framing or a roundup format is not by itself a reason to score below 7. For each item also write a one-line "why" (at most 140 characters, concrete, plain words): for a keep, which question it serves and what it offers; for a drop, why not.

Items:
${JSON.stringify(items, null, 1)}

Reply with only a JSON array, one object per item in order: [{"i": 0, "score": 3, "why": "..."}, ...]`;
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system,
      messages: [{ role: "user", content: prompt }],
    });
    const text = res.content.map((c) => (c.type === "text" ? c.text : "")).join("");
    return parseJudgments(text, docs.length);
  };
}

export function parseJudgments(text: string, n: number): Judgment[] {
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) throw new Error(`No JSON array in model reply: ${text.slice(0, 200)}`);
  const arr = JSON.parse(match[0]) as { i: number; score: number; why: string }[];
  const out: Judgment[] = [];
  for (let i = 0; i < n; i++) {
    const j = arr.find((x) => x.i === i);
    if (!j || typeof j.score !== "number" || typeof j.why !== "string") {
      throw new Error(`Model reply missing a valid judgment for item ${i}`);
    }
    out.push({ score: j.score, why: j.why.trim() });
  }
  return out;
}

// --- CLI ------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const sinceIdx = args.indexOf("--since");
  const since = sinceIdx >= 0 ? new Date(args[sinceIdx + 1] ?? "") : undefined;
  if (since && isNaN(since.getTime())) throw new Error(`Bad --since: ${args[sinceIdx + 1]}`);

  const token = process.env.READWISE_TOKEN;
  if (!token) throw new Error("READWISE_TOKEN not set");
  const root = path.join(import.meta.dir, "..");
  const taste = fs.readFileSync(path.join(root, "taste.md"), "utf8");

  const result = await run({
    reader: readwiseClient(token),
    judge: claudeJudge(new Anthropic(), taste),
    statePath: path.join(root, "data/filter-state.json"),
    ledgerPath: path.join(root, "data/filter-ledger.jsonl"),
    feedClasses: loadFeedClasses(path.join(root, "data/feed-classes.json")),
    dryRun,
    since,
  });
  console.log(`${new Date().toISOString()} ${dryRun ? "[dry-run] " : ""}${JSON.stringify(result)}`);
  if (result.failedBatches > 0) {
    await Sentry.flush(2000);
    process.exitCode = 1;
  }
}

if (import.meta.main) {
  main().catch(async (err) => {
    console.error(err);
    Sentry.captureException(err);
    await Sentry.flush(2000);
    process.exit(1);
  });
}
