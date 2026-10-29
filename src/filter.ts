// Feed filter for Readwise Reader: judges new documents in the `feed` location
// against Jason's Fascinations note, gives keeps a one-line why as their summary, deletes the rest.
// Usage: bun run src/filter.ts [--dry-run] [--since <iso>]
import "./instrument";
import * as Sentry from "@sentry/bun";
import Anthropic from "@anthropic-ai/sdk";
import * as fs from "fs";
import * as path from "path";

export const MODEL = "claude-sonnet-5-5";
export const KEEP_THRESHOLD = 5;
export const DAILY_BUDGET = 20;
const BUDGET_TZ = "America/Los_Angeles";
const BATCH_SIZE = 20;
const API = "https://readwise.io/api/v3";
// The next watermark trails the run start, because a doc's saved_at can precede
// the moment it becomes listable. Overlap is safe: keeps are in the ledger and deletes are gone.
const WATERMARK_LAG_MS = 10 * 60 * 1000;
export const DEFAULT_TASTE_PATH = "/opt/notes/Fascinations.md";
const TASTE_SECTIONS = ["Now", "Long questions", "Taste"];

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

export type Judge = (docs: Doc[], exemplars: Doc[], taste: string) => Promise<Judgment[]>;

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
// (substack.com/@name, open.substack.com/pub/name) take the publication from the path,
// this server's /archive proxy (Foreign Affairs, Economist) the wrapped url's host, and
// forwarded newsletters (mailto:reader-forwarded-email/...) their author.
export function feedKey(doc: Doc): string {
  let host = "";
  let parts: string[] = [];
  if (doc.source_url?.startsWith("mailto:")) return `email:${doc.author ?? "?"}`;
  try {
    let u = new URL(doc.source_url ?? "");
    const wrapped = u.hostname === "rss.jasonbenn.com" && u.searchParams.get("url");
    if (wrapped) u = new URL(wrapped);
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

// Keys under which two arrivals count as the same post: the source url without scheme,
// www, tracking params or trailing slash (the /archive proxy unwrapped), and the title.
export function dedupeKeys(doc: Doc): string[] {
  const keys: string[] = [];
  try {
    let u = new URL(doc.source_url ?? "");
    const wrapped = u.hostname === "rss.jasonbenn.com" && u.searchParams.get("url");
    if (wrapped) u = new URL(wrapped);
    for (const k of [...u.searchParams.keys()]) if (k.startsWith("utm_")) u.searchParams.delete(k);
    if (!u.protocol.startsWith("mailto")) keys.push(`url:${u.hostname.replace(/^www\./, "")}${u.pathname.replace(/\/$/, "")}${u.search}`);
  } catch {}
  const title = (doc.title ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  if (title) keys.push(`title:${title}`);
  return keys;
}

export type FeedClass = "timeless" | "topical" | "low";
export type FeedClasses = Record<string, { class: FeedClass; reason: string }>;

export function loadFeedClasses(p: string): FeedClasses {
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : {};
}

// --- Taste ----------------------------------------------------------------

// The note's "## Now", "## Long questions" and "## Taste" sections, headings included;
// everything else (preamble, "## Lately", other sections) is dropped.
export function extractTaste(note: string): string {
  const sections = note.split(/^(?=## )/m);
  return sections
    .filter((s) => TASTE_SECTIONS.includes(s.match(/^## (.*)/)?.[1]?.trim() ?? ""))
    .filter((s) => s.replace(/^## .*/, "").trim() !== "")
    .map((s) => s.trim())
    .join("\n\n");
}

/** The taste text, read fresh from disk; null when the note is missing or its sections are empty. */
export function loadTaste(tastePath: string): string | null {
  if (!fs.existsSync(tastePath)) return null;
  return extractTaste(fs.readFileSync(tastePath, "utf8")) || null;
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
  action: "keep" | "delete" | "dry-run" | "sweep-delete" | "sweep-gone";
  model: string | null;
  reader_url?: string;
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

// `day` (a Pacific calendar date) and `kept` count keeps against DAILY_BUDGET across runs.
export interface State {
  watermark: string;
  day?: string;
  kept?: number;
}

// Keeps are untagged, so the ledger is what stops a later run from re-judging one.
function keptIds(ledgerPath: string): Set<string> {
  if (!fs.existsSync(ledgerPath)) return new Set();
  const ids = new Set<string>();
  for (const l of fs.readFileSync(ledgerPath, "utf8").split("\n")) {
    if (l.includes('"action":"keep"')) ids.add((JSON.parse(l) as LedgerEntry).id);
  }
  return ids;
}

function readState(statePath: string): State | null {
  if (!fs.existsSync(statePath)) return null;
  return JSON.parse(fs.readFileSync(statePath, "utf8"));
}

function writeState(statePath: string, state: State) {
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify(state) + "\n");
}

export function pacificDay(d: Date): string {
  return d.toLocaleDateString("en-CA", { timeZone: BUDGET_TZ });
}

// --- Run ------------------------------------------------------------------

export interface RunOptions {
  reader: Reader;
  judge: Judge;
  statePath: string;
  ledgerPath: string;
  tastePath: string;
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

  // Without taste every score is noise, so the run touches nothing and the watermark holds.
  const taste = loadTaste(opts.tastePath);
  if (!taste) {
    const msg = `No taste in ${opts.tastePath} (missing, or ${TASTE_SECTIONS.join("/")} empty); skipped run.`;
    log(`WARNING: ${msg}`);
    Sentry.captureMessage(msg, "warning");
    return result;
  }

  const state = readState(statePath);
  const watermark = opts.since ?? (state && new Date(state.watermark));
  if (!watermark) {
    if (!dryRun) writeState(statePath, { watermark: now.toISOString() });
    log(`No watermark; initialized to ${now.toISOString()}. Nothing processed.`);
    return result;
  }

  const listed = await reader.list({ location: "feed", updatedAfter: watermark.toISOString() });
  const kept = keptIds(ledgerPath);
  const candidates = listed.filter((d) => {
    const reason = untouchableReason(d, watermark) ?? (kept.has(d.id) ? "already kept" : null);
    if (reason) result.skipped++;
    return !reason;
  });
  log(`${listed.length} listed, ${candidates.length} candidates since ${watermark.toISOString()}`);

  const today = pacificDay(now);
  let keptToday = state?.day === today ? (state.kept ?? 0) : 0;
  const saveCount = () =>
    writeState(statePath, { watermark: watermark.toISOString(), ...readState(statePath), day: today, kept: keptToday });

  const act = async (doc: Doc, j: Judgment, model: string | null) => {
    const overBudget = j.score >= KEEP_THRESHOLD && keptToday >= DAILY_BUDGET;
    const decision = j.score >= KEEP_THRESHOLD && !overBudget ? "keep" : "drop";
    const why = overBudget ? `over daily budget: ${j.why}` : j.why;
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
      why,
      decision,
      action,
      model,
    });
    result.judged++;
    if (decision === "keep") {
      result.kept++;
      keptToday++;
    } else result.dropped++;
    if (action === "keep") {
      await reader.update(doc.id, { summary: j.why.slice(0, 140) });
      saveCount();
    }
    if (action === "delete") await reader.delete(doc.id);
  };

  for (const doc of candidates.filter(isShort)) await act(doc, { score: 0, why: "YouTube Short" }, null);

  // Judge everything first so the day's budget goes to the run's highest scores.
  const toJudge = candidates.filter((d) => !isShort(d));
  const judged: [Doc, Judgment][] = [];
  if (toJudge.length > 0) {
    const exemplars = await handSavedExemplars(reader);
    for (let i = 0; i < toJudge.length; i += BATCH_SIZE) {
      const batch = toJudge.slice(i, i + BATCH_SIZE);
      try {
        const judgments = await judge(batch, exemplars, taste);
        batch.forEach((d, k) => judged.push([d, judgments[k]!]));
      } catch (err) {
        // A failed batch stays in the feed; the watermark holds so the next run retries it.
        result.failedBatches++;
        Sentry.captureException(err);
        log(`Batch ${i / BATCH_SIZE} failed, left in feed: ${err}`);
      }
    }
  }
  judged.sort((a, b) => b[1].score - a[1].score);
  // The same post often arrives from two feeds; only its highest-scored copy competes.
  const firstSeen = new Map<string, string>();
  for (const [doc, j] of judged) {
    const keys = dedupeKeys(doc);
    const original = keys.map((k) => firstSeen.get(k)).find(Boolean);
    for (const k of keys) if (!firstSeen.has(k)) firstSeen.set(k, doc.id);
    if (original) await act(doc, { score: 0, why: `duplicate of ${original}` }, MODEL);
    else await act(doc, j, MODEL);
  }

  if (!dryRun && result.failedBatches === 0) {
    writeState(statePath, { ...readState(statePath), watermark: new Date(now.getTime() - WATERMARK_LAG_MS).toISOString() });
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

export class HttpError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

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
      if (!res.ok) throw new HttpError(`${method} ${url}: ${res.status} ${await res.text()}`, res.status);
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

export const SCORING_GUIDE = `Scoring guide. Judge the piece, not the blurb: feed blurbs are short, so infer from title, author and source. 9-10: directly feeds a live question with a real argument; he would bring it to Church. 5-8: a thoughtful piece he would be glad to find: touches a live question, comes from a writer he follows, or is a serious essay on how to live, think or organize together. 2-4: competent but off his questions; roundups and overviews score a notch below a comparable essay, not zero. 0-1: news, promo, product, short-form, or noise.`;

export function claudeJudge(client: Anthropic): Judge {
  return async (docs, exemplars, taste) => {
    const items = docs.map((d, i) => ({
      i,
      title: d.title,
      site: d.site_name,
      author: d.author,
      url: d.source_url,
      blurb: (d.summary ?? "").slice(0, 500),
    }));
    const system = `You filter Jason's RSS feed. Here is his taste:\n\n${taste}\n\n${SCORING_GUIDE}\n\nThings he recently chose himself (title — site), the strongest signal of what he wants:\n${exemplars.map((d) => `- ${line(d)}`).join("\n")}`;
    const prompt = `Score each item 0-10 for whether Jason should read it. Scores of ${KEEP_THRESHOLD}+ are kept. Calibrate so that roughly the best 1 in 5 items reach ${KEEP_THRESHOLD}: in a batch of 20, usually 4 or 5 items score ${KEEP_THRESHOLD}+, more on a rich batch; if fewer than 3 do, you are scoring too harshly. Score relative to the batch: its strongest few non-news essays or talks touching his questions even loosely reach ${KEEP_THRESHOLD}, unless every item is news, promo or noise. A short blurb or a familiar framing is not by itself a reason to score below ${KEEP_THRESHOLD}. For each item also write a one-line "why" (at most 140 characters, concrete, plain words): for a keep, which question it serves and what it offers; for a drop, why not.

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

  const result = await run({
    reader: readwiseClient(token),
    judge: claudeJudge(new Anthropic()),
    statePath: path.join(root, "data/filter-state.json"),
    ledgerPath: path.join(root, "data/filter-ledger.jsonl"),
    tastePath: process.env.TASTE_PATH ?? DEFAULT_TASTE_PATH,
    dryRun,
    since,
  });
  console.log(`${new Date().toISOString()} ${dryRun ? "[dry-run] " : ""}${JSON.stringify(result)}`);
  await Sentry.flush(2000);
  if (result.failedBatches > 0) process.exitCode = 1;
}

if (import.meta.main) {
  main().catch(async (err) => {
    console.error(err);
    Sentry.captureException(err);
    await Sentry.flush(2000);
    process.exit(1);
  });
}
