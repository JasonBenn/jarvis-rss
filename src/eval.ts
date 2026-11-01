// Runs the filter's judge over the engagement eval set and scores it against Jason's labels.
// Usage:
//   bun run src/eval.ts --prompt <name>            judge the set with a prompt from eval-prompts.ts
//   bun run src/eval.ts --report <name> [<name>…]  print metrics and misses for finished runs
// Each eval doc is judged inside a batch of real feed arrivals (from data/feed-backlog.json),
// because the prompt calibrates scores relative to the batch. Runs land in data/eval-runs/,
// never in the production ledger.
import "./instrument";
import Anthropic from "@anthropic-ai/sdk";
import * as fs from "fs";
import * as path from "path";
import { KEEP_THRESHOLD, claudeJudge, isHandSaved, isShort, loadTaste, DEFAULT_TASTE_PATH, type Doc } from "./filter";
import type { EvalRow, Label, ReaderDoc } from "./eval-set";
import { PROMPTS } from "./eval-prompts";

export const MAX_DOCS = 400;
// Older likes reflect older taste; the judge reads today's Fascinations note.
export const SINCE = "2025-01-01";
export const HOLDOUT = 0.3;
const SEED = 7;
const EVAL_PER_BATCH = 5;
const BATCH = 20;
// The API key is shared with other services on nose and caps concurrent connections.
const CONCURRENCY = Number(process.env.EVAL_CONCURRENCY ?? 2);

export const POSITIVE: Label[] = ["strong_like", "like"];
export const NEGATIVE: Label[] = ["dislike", "weak_dislike"];

export function hash(s: string): number {
  let h = 2166136261 ^ SEED;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  // FNV leaves the high bits poorly mixed for near-identical ids; finish with murmur's fmix.
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 2 ** 32;
}

export const split = (id: string): "train" | "holdout" => (hash(`split:${id}`) < HOLDOUT ? "holdout" : "train");

/** At most `max` rows, sampled per label and feed-vs-hand origin in proportion, deterministically by id. */
export function capRows(rows: EvalRow[], max = MAX_DOCS): EvalRow[] {
  if (rows.length <= max) return rows;
  const byLabel = new Map<string, EvalRow[]>();
  const stratum = (r: EvalRow) => `${r.label}:${r.source === "Reader RSS"}`;
  for (const r of rows) byLabel.set(stratum(r), [...(byLabel.get(stratum(r)) ?? []), r]);
  const out: EvalRow[] = [];
  for (const rs of byLabel.values()) {
    const n = Math.round((rs.length / rows.length) * max);
    out.push(...rs.sort((a, b) => hash(a.id) - hash(b.id)).slice(0, n));
  }
  return out;
}

export interface Scored {
  id: string;
  label: Label;
  split: "train" | "holdout";
  score: number;
  why: string;
  title: string | null;
  feed: string;
  rss: boolean;
}

export interface Metrics {
  n: number;
  tp: number;
  fp: number;
  fn: number;
  tn: number;
  precision: number;
  recall: number;
  f1: number;
}

/** Keep (score >= threshold) as the prediction, likes as positives, dislikes as negatives. */
export function metrics(rows: Scored[], negatives: Label[] = NEGATIVE): Metrics {
  let tp = 0, fp = 0, fn = 0, tn = 0;
  for (const r of rows) {
    const keep = r.score >= KEEP_THRESHOLD;
    if (POSITIVE.includes(r.label)) keep ? tp++ : fn++;
    else if (negatives.includes(r.label)) keep ? fp++ : tn++;
  }
  const precision = tp / (tp + fp || 1);
  const recall = tp / (tp + fn || 1);
  const f1 = (2 * precision * recall) / (precision + recall || 1);
  return { n: tp + fp + fn + tn, tp, fp, fn, tn, precision, recall, f1 };
}

const toDoc = (r: EvalRow): Doc => ({
  id: r.id,
  url: "",
  source_url: r.url,
  title: r.title,
  author: r.author,
  site_name: r.site_name,
  summary: r.summary,
  source: "Reader RSS",
  category: "rss",
  location: "feed",
  tags: {},
  notes: "",
  parent_id: null,
  reading_progress: 0,
  first_opened_at: null,
  last_opened_at: null,
  saved_at: "",
});

async function judgeSet(promptName: string, root: string) {
  const build = PROMPTS[promptName];
  if (!build) throw new Error(`No prompt ${promptName}; have ${Object.keys(PROMPTS).join(", ")}`);
  const taste = loadTaste(process.env.TASTE_PATH ?? DEFAULT_TASTE_PATH);
  if (!taste) throw new Error("No taste");

  const rows = capRows(readJsonl<EvalRow>(path.join(root, "data/eval-set.jsonl")).filter((r) => r.metrics.saved_at >= SINCE));
  const evalIds = new Set(rows.map((r) => r.id));
  const snap: { docs: ReaderDoc[] } = JSON.parse(fs.readFileSync(path.join(root, "data/reader-snapshot.json"), "utf8"));
  // The same 40 latest hand saves the filter would show, minus anything being graded.
  const exemplars = snap.docs
    .filter((d) => isHandSaved(d) && !evalIds.has(d.id))
    .sort((a, b) => b.saved_at.localeCompare(a.saved_at))
    .slice(0, 40);
  const backlog: { docs: Doc[] } = JSON.parse(fs.readFileSync(path.join(root, "data/feed-backlog.json"), "utf8"));
  const distractors = backlog.docs
    .filter((d) => !evalIds.has(d.id) && !isShort(d) && !d.first_opened_at)
    .sort((a, b) => hash(a.id) - hash(b.id));

  const outPath = path.join(root, `data/eval-runs/${promptName}.jsonl`);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const done = new Set(fs.existsSync(outPath) ? readJsonl<Scored>(outPath).map((s) => s.id) : []);

  // Fixed batches: the same eval docs meet the same distractors in every run.
  const ordered = [...rows].sort((a, b) => hash(`order:${a.id}`) - hash(`order:${b.id}`));
  const batches: { docs: Doc[]; evalRows: (EvalRow | null)[] }[] = [];
  for (let i = 0, d = 0; i < ordered.length; i += EVAL_PER_BATCH) {
    const evalRows: (EvalRow | null)[] = ordered.slice(i, i + EVAL_PER_BATCH);
    const fill = distractors.slice(d, d + BATCH - evalRows.length);
    d += fill.length;
    const mixed = [...evalRows.map((r) => ({ doc: toDoc(r!), row: r })), ...fill.map((doc) => ({ doc, row: null }))].sort(
      (a, b) => hash(`mix:${a.doc.id}`) - hash(`mix:${b.doc.id}`),
    );
    batches.push({ docs: mixed.map((m) => m.doc), evalRows: mixed.map((m) => m.row) });
  }

  const judge = claudeJudge(new Anthropic(), build);
  const todo = batches.filter((b) => b.evalRows.some((r) => r && !done.has(r.id)));
  console.error(`${promptName}: ${rows.length} docs, ${batches.length} batches, ${todo.length} to judge`);
  let next = 0;
  const worker = async () => {
    while (next < todo.length) {
      const b = todo[next++]!;
      for (let attempt = 0; ; attempt++) {
        try {
          const js = await judge(b.docs, exemplars, taste);
          const lines = b.evalRows.flatMap((r, k) =>
            r ? [JSON.stringify({ id: r.id, label: r.label, split: split(r.id), score: js[k]!.score, why: js[k]!.why, title: r.title, feed: r.feed, rss: r.source === "Reader RSS" } satisfies Scored)] : [],
          );
          fs.appendFileSync(outPath, lines.join("\n") + "\n");
          break;
        } catch (err) {
          if (attempt >= 8) throw err;
          console.error(`retry after ${err}`);
          await new Promise((r) => setTimeout(r, 15000 * (attempt + 1)));
        }
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  console.error(`wrote ${outPath}`);
}

const f2 = (x: number) => x.toFixed(2);

/** Chance that a random liked doc outscores a random disliked one (ties count half): ranking quality, free of the threshold. */
export function auc(rows: Scored[]): number {
  const pos = rows.filter((r) => POSITIVE.includes(r.label)).map((r) => r.score);
  const neg = rows.filter((r) => NEGATIVE.includes(r.label)).map((r) => r.score);
  let s = 0;
  for (const p of pos) for (const n of neg) s += p > n ? 1 : p === n ? 0.5 : 0;
  return s / (pos.length * neg.length || 1);
}

export function report(name: string, scored: Scored[]): string {
  const out: string[] = [`## ${name}`];
  out.push("| split | n | P | R | F1 | AUC | P (strict) | R (strict) | F1 (strict) |", "|---|---|---|---|---|---|---|---|---|");
  const slices: [string, Scored[]][] = [
    ["train", scored.filter((r) => r.split === "train")],
    ["holdout", scored.filter((r) => r.split === "holdout")],
    ["all", scored],
    ["holdout, feed arrivals", scored.filter((r) => r.split === "holdout" && r.rss)],
    ["all, feed arrivals", scored.filter((r) => r.rss)],
    ["all, hand saves", scored.filter((r) => !r.rss)],
  ];
  for (const [s, rs] of slices) {
    const m = metrics(rs);
    const strict = metrics(rs, ["dislike"]);
    out.push(`| ${s} | ${m.n} | ${f2(m.precision)} | ${f2(m.recall)} | ${f2(m.f1)} | ${f2(auc(rs))} | ${f2(strict.precision)} | ${f2(strict.recall)} | ${f2(strict.f1)} |`);
  }
  out.push("", "Score distribution per label (count at each score 0..10, mean, share kept):", "");
  for (const l of [...POSITIVE, ...NEGATIVE]) {
    const rs = scored.filter((r) => r.label === l);
    if (!rs.length) continue;
    const hist = Array.from({ length: 11 }, (_, k) => rs.filter((r) => Math.round(r.score) === k).length);
    const mean = rs.reduce((a, r) => a + r.score, 0) / rs.length;
    const kept = rs.filter((r) => r.score >= KEEP_THRESHOLD).length / rs.length;
    out.push(`- ${l} (n=${rs.length}): [${hist.join(" ")}] mean ${f2(mean)}, kept ${Math.round(kept * 100)}%`);
  }
  const misses = (rs: Scored[]) => rs.slice(0, 15).map((r) => `| ${r.score} | ${r.label} | ${(r.title ?? "").replace(/\|/g, "/").slice(0, 70)} | ${r.feed} | ${r.why.replace(/\|/g, "/")} |`);
  const liked = scored.filter((r) => POSITIVE.includes(r.label) && r.score < KEEP_THRESHOLD).sort((a, b) => a.score - b.score);
  const disliked = scored.filter((r) => NEGATIVE.includes(r.label) && r.score >= KEEP_THRESHOLD).sort((a, b) => b.score - a.score || (a.label === "dislike" ? -1 : 1));
  out.push("", `Liked but scored low (${liked.length}; worst 15):`, "", "| score | label | title | feed | judge's why |", "|---|---|---|---|---|", ...misses(liked));
  out.push("", `Disliked but scored high (${disliked.length}; worst 15):`, "", "| score | label | title | feed | judge's why |", "|---|---|---|---|---|", ...misses(disliked));
  return out.join("\n");
}

export function readJsonl<T>(p: string): T[] {
  return fs.readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

async function main() {
  const args = process.argv.slice(2);
  const root = path.join(import.meta.dir, "..");
  const pi = args.indexOf("--prompt");
  if (pi >= 0) return judgeSet(args[pi + 1]!, root);
  const ri = args.indexOf("--report");
  if (ri >= 0) {
    for (const name of args.slice(ri + 1)) console.log(report(name, readJsonl<Scored>(path.join(root, `data/eval-runs/${name}.jsonl`))) + "\n");
    return;
  }
  console.error("Usage: bun run src/eval.ts --prompt <name> | --report <name>...");
  process.exit(2);
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
