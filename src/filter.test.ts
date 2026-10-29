import { describe, expect, test, beforeEach } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  run,
  untouchableReason,
  isShort,
  isHandSaved,
  feedKey,
  parseJudgments,
  readwiseClient,
  pacificDay,
  dedupeKeys,
  extractTaste,
  DAILY_BUDGET,
  KEEP_THRESHOLD,
  type Doc,
  type Reader,
  type Judge,
  type LedgerEntry,
} from "./filter";

const WATERMARK = new Date("2026-10-26T00:00:00Z");

function doc(over: Partial<Doc> = {}): Doc {
  const id = over.id ?? Math.random().toString(36).slice(2);
  return {
    id,
    url: "https://read.readwise.io/read/x",
    source_url: `https://example.com/essay-${id}`,
    title: `An essay ${id}`,
    author: "Someone",
    site_name: "example.com",
    summary: "blurb",
    source: "Reader RSS",
    category: "rss",
    location: "feed",
    tags: {},
    notes: "",
    parent_id: null,
    reading_progress: 0,
    first_opened_at: null,
    last_opened_at: null,
    saved_at: "2026-10-26T06:00:00Z",
    ...over,
  };
}

class MockReader implements Reader {
  calls: string[] = [];
  constructor(public docs: Doc[], public exemplars: Doc[] = []) {}
  async list(params: Record<string, string>) {
    if (params.location === "feed") return this.docs;
    return this.exemplars.filter((d) => d.location === params.location);
  }
  async get(id: string) {
    return this.docs.find((d) => d.id === id) ?? null;
  }
  async update(id: string, body: Record<string, unknown>) {
    this.calls.push(`update ${id} ${JSON.stringify(body)}`);
  }
  async delete(id: string) {
    this.calls.push(`delete ${id}`);
  }
}

const scoreAll = (score: number): Judge => async (docs) => docs.map(() => ({ score, why: `scored ${score}` }));

let dir: string;
let statePath: string;
let ledgerPath: string;
let tastePath: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "filter-"));
  statePath = path.join(dir, "state.json");
  ledgerPath = path.join(dir, "ledger.jsonl");
  tastePath = path.join(dir, "Fascinations.md");
  fs.writeFileSync(tastePath, "## Taste\nEssays, not news.\n");
  fs.writeFileSync(statePath, JSON.stringify({ watermark: WATERMARK.toISOString() }));
});

const ledger = (): LedgerEntry[] =>
  fs.existsSync(ledgerPath)
    ? fs.readFileSync(ledgerPath, "utf8").trim().split("\n").map((l) => JSON.parse(l))
    : [];

const go = (reader: Reader, judge: Judge, extra: Partial<Parameters<typeof run>[0]> = {}) =>
  run({ reader, judge, statePath, ledgerPath, tastePath, dryRun: false, log: () => {}, ...extra });

describe("rule 1: only the feed location", () => {
  test.each(["new", "later", "archive", "shortlist"])("never touches %s", async (location) => {
    const reader = new MockReader([doc({ location })]);
    await go(reader, scoreAll(0));
    expect(reader.calls).toEqual([]);
    expect(ledger()).toEqual([]);
  });
});

describe("rule 2: never Jason's documents", () => {
  const cases: [string, Partial<Doc>][] = [
    ["first_opened_at", { first_opened_at: "2026-10-26T07:00:00Z" }],
    ["last_opened_at", { last_opened_at: "2026-10-26T07:00:00Z" }],
    ["reading_progress", { reading_progress: 0.1 }],
    ["tags", { tags: { mine: { name: "mine" } } }],
    ["notes", { notes: "my thought" }],
    ["highlight", { parent_id: "abc" }],
  ];
  test.each(cases)("skips a doc with %s", async (_, over) => {
    const reader = new MockReader([doc(over)]);
    await go(reader, scoreAll(0));
    expect(reader.calls).toEqual([]);
  });

  test("a hand-curated pick saved into feed after the watermark is never judged or deleted", async () => {
    const pick = doc({ saved_at: "2026-10-26T09:00:00Z", tags: { pick: { name: "pick", type: "manual" } } });
    const reader = new MockReader([pick]);
    let judged = 0;
    await go(reader, async (docs) => {
      judged += docs.length;
      return docs.map(() => ({ score: 0, why: "n" }));
    });
    expect(judged).toBe(0);
    expect(reader.calls).toEqual([]);
    expect(ledger()).toEqual([]);
  });

  test("a keep from an earlier run is not judged again when it is re-listed", async () => {
    const d = doc({ id: "k" });
    await go(new MockReader([d]), scoreAll(9));
    expect(ledger().map((e) => e.action)).toEqual(["keep"]);
    const reader = new MockReader([d]);
    await go(reader, scoreAll(0), { since: WATERMARK });
    expect(reader.calls).toEqual([]);
    expect(ledger().map((e) => e.action)).toEqual(["keep"]);
  });

  test("re-reads before deleting and skips a doc opened since the list call", async () => {
    const d = doc({ id: "a" });
    const reader = new MockReader([d]);
    reader.get = async () => ({ ...d, first_opened_at: "2026-10-26T08:00:00Z" });
    await go(reader, scoreAll(0));
    expect(reader.calls).toEqual([]);
  });
});

describe("rule 3: watermark", () => {
  test("skips docs saved before the watermark", async () => {
    const reader = new MockReader([doc({ saved_at: "2026-10-25T23:59:00Z" })]);
    await go(reader, scoreAll(0));
    expect(reader.calls).toEqual([]);
  });

  test("first run initializes the watermark and processes nothing", async () => {
    fs.rmSync(statePath);
    const reader = new MockReader([doc()]);
    const now = new Date("2026-10-26T12:00:00Z");
    await go(reader, scoreAll(0), { now });
    expect(reader.calls).toEqual([]);
    expect(JSON.parse(fs.readFileSync(statePath, "utf8")).watermark).toBe(now.toISOString());
  });

  test("--since overrides a missing watermark", async () => {
    fs.rmSync(statePath);
    const reader = new MockReader([doc({ id: "a" })]);
    await go(reader, scoreAll(0), { since: WATERMARK });
    expect(reader.calls).toEqual(["delete a"]);
  });

  test("dry run writes the ledger but never the API or state", async () => {
    const reader = new MockReader([doc({ id: "a" }), doc({ id: "b" })]);
    const before = fs.readFileSync(statePath, "utf8");
    await go(reader, scoreAll(8), { dryRun: true });
    expect(reader.calls).toEqual([]);
    expect(ledger().map((e) => e.action)).toEqual(["dry-run", "dry-run"]);
    expect(fs.readFileSync(statePath, "utf8")).toBe(before);
  });
});

describe("rule 4: ledger before delete", () => {
  test("each judgment is in the ledger before the API call", async () => {
    const reader = new MockReader([doc({ id: "keep1" }), doc({ id: "drop1" })]);
    const seen: Record<string, string[]> = {};
    const orig = { update: reader.update.bind(reader), delete: reader.delete.bind(reader) };
    reader.update = async (id, body) => {
      seen[id] = ledger().map((e) => e.id);
      return orig.update(id, body);
    };
    reader.delete = async (id) => {
      seen[id] = ledger().map((e) => e.id);
      return orig.delete(id);
    };
    const judge: Judge = async (docs) =>
      docs.map((d) => (d.id === "keep1" ? { score: 9, why: "on great love" } : { score: 2, why: "news" }));
    await go(reader, judge);
    expect(seen.keep1).toContain("keep1");
    expect(seen.drop1).toContain("drop1");
    expect(reader.calls).toEqual([
      `update keep1 ${JSON.stringify({ summary: "on great love" })}`,
      "delete drop1",
    ]);
    const e = ledger().find((x) => x.id === "drop1")!;
    expect(Object.keys(e).sort()).toEqual(
      ["action", "author", "decision", "id", "model", "score", "site", "title", "ts", "url", "why"].sort(),
    );
    expect(e.action).toBe("delete");
    expect(e.url).toBe("https://example.com/essay-drop1");
  });
});

describe("rule 5: YouTube Shorts", () => {
  test("drops a Short without a model call", async () => {
    const reader = new MockReader([doc({ id: "s", source_url: "https://www.youtube.com/shorts/abc" })]);
    let judged = 0;
    await go(reader, async (docs) => {
      judged += docs.length;
      return docs.map(() => ({ score: 10, why: "x" }));
    });
    expect(judged).toBe(0);
    expect(reader.calls).toEqual(["delete s"]);
  });

  test("isShort uses duration when known", () => {
    expect(isShort(doc({ duration_seconds: 45 }))).toBe(true);
    expect(isShort(doc({ duration_seconds: 600 }))).toBe(false);
    expect(isShort(doc({ source_url: "https://www.youtube.com/watch?v=x" }))).toBe(false);
  });
});

describe("rule 6: rate limits", () => {
  test("honors 429 Retry-After then succeeds", async () => {
    const realFetch = globalThis.fetch;
    const hits: number[] = [];
    globalThis.fetch = (async () => {
      hits.push(Date.now());
      if (hits.length === 1) return new Response("slow down", { status: 429, headers: { "Retry-After": "1" } });
      return new Response(JSON.stringify({ results: [doc()], nextPageCursor: null }), { status: 200 });
    }) as unknown as typeof fetch;
    try {
      const docs = await readwiseClient("t").list({ location: "feed" });
      expect(docs.length).toBe(1);
      expect(hits[1]! - hits[0]!).toBeGreaterThanOrEqual(1000);
    } finally {
      globalThis.fetch = realFetch;
    }
  }, 15000);

  test("pages with pageCursor", async () => {
    const realFetch = globalThis.fetch;
    const urls: string[] = [];
    globalThis.fetch = (async (url: string) => {
      urls.push(url);
      const page = urls.length === 1 ? { results: [doc()], nextPageCursor: "c2" } : { results: [doc()], nextPageCursor: null };
      return new Response(JSON.stringify(page), { status: 200 });
    }) as unknown as typeof fetch;
    try {
      const docs = await readwiseClient("t").list({ location: "feed", updatedAfter: "2026-10-26T00:00:00Z" });
      expect(docs.length).toBe(2);
      expect(urls[1]).toContain("pageCursor=c2");
    } finally {
      globalThis.fetch = realFetch;
    }
  }, 15000);
});

describe("rule 7: model failure skips the batch", () => {
  test("a failed batch deletes nothing and holds the watermark", async () => {
    const reader = new MockReader([doc({ id: "a" })]);
    const before = fs.readFileSync(statePath, "utf8");
    const result = await go(reader, async () => {
      throw new Error("model down");
    });
    expect(result.failedBatches).toBe(1);
    expect(reader.calls).toEqual([]);
    expect(fs.readFileSync(statePath, "utf8")).toBe(before);
  });

  test("a malformed reply throws", () => {
    expect(() => parseJudgments('[{"i":0,"score":3,"why":"x"}]', 2)).toThrow();
    expect(() => parseJudgments("no json", 1)).toThrow();
    expect(parseJudgments('ok [{"i":0,"score":8,"why":" y "}]', 1)).toEqual([{ score: 8, why: "y" }]);
  });
});

describe("thresholds and exemplars", () => {
  test("keeps at the threshold, drops just below it", async () => {
    const reader = new MockReader([doc({ id: "a" }), doc({ id: "b" })]);
    await go(reader, async (docs) => docs.map((d) => ({ score: d.id === "a" ? KEEP_THRESHOLD : KEEP_THRESHOLD - 1, why: "w" })));
    expect(reader.calls[0]).toStartWith("update a");
    expect(reader.calls[1]).toBe("delete b");
  });

  test("hand saves exclude feed and newsletter docs", () => {
    expect(isHandSaved(doc({ location: "new", source: "Readwise web highlighter", category: "article" }))).toBe(true);
    expect(isHandSaved(doc({ location: "later", source: "Reader RSS" }))).toBe(false);
    expect(isHandSaved(doc({ location: "new", source: null, category: "email" }))).toBe(false);
    expect(isHandSaved(doc({ location: "feed", source: "Reader Share Sheet iOS" }))).toBe(false);
  });

  test("untouchableReason passes a clean feed doc", () => {
    expect(untouchableReason(doc(), WATERMARK)).toBeNull();
  });
});

describe("feed keys", () => {
  test("feedKey groups by channel or publication", () => {
    expect(feedKey(doc({ site_name: "YouTube", author: "TED", source_url: "https://www.youtube.com/watch?v=1" }))).toBe("youtube:TED");
    expect(feedKey(doc({ source_url: "https://www.astralcodexten.com/p/x" }))).toBe("astralcodexten.com");
    expect(feedKey(doc({ source_url: "https://open.substack.com/pub/foo/p/x" }))).toBe("foo.substack.com");
    expect(feedKey(doc({ source_url: "https://substack.com/@bar/note/1" }))).toBe("bar.substack.com");
    expect(feedKey(doc({ source_url: "https://rss.jasonbenn.com/archive?url=https%3A%2F%2Fwww.foreignaffairs.com%2Fx" }))).toBe("foreignaffairs.com");
    expect(feedKey(doc({ source_url: "mailto:reader-forwarded-email/abc", author: "Pirate Wires Daily" }))).toBe("email:Pirate Wires Daily");
  });
});

describe("daily budget", () => {
  const docs = (prefix: string, n: number, saved_at = "2026-10-26T06:00:00Z") =>
    Array.from({ length: n }, (_, i) => doc({ id: `${prefix}${i}`, saved_at }));
  const state = () => JSON.parse(fs.readFileSync(statePath, "utf8"));
  const kept = (r: MockReader) => r.calls.filter((c) => c.startsWith("update")).length;
  // 2026-10-26 09:00 PT and 23:30 PT, then 00:30 PT the next day.
  const morning = new Date("2026-10-26T16:00:00Z");
  const lateNight = new Date("2026-10-27T06:30:00Z");
  const afterMidnight = new Date("2026-10-27T07:30:00Z");

  test("pacificDay uses the Los Angeles calendar", () => {
    expect(pacificDay(lateNight)).toBe("2026-10-26");
    expect(pacificDay(afterMidnight)).toBe("2026-10-27");
  });

  test("the cap applies across runs within a day", async () => {
    const first = new MockReader(docs("a", DAILY_BUDGET - 5));
    await go(first, scoreAll(9), { now: morning });
    expect(kept(first)).toBe(DAILY_BUDGET - 5);
    expect(state()).toMatchObject({ day: "2026-10-26", kept: DAILY_BUDGET - 5 });

    const second = new MockReader(docs("b", 10, "2026-10-27T06:00:00Z"));
    await go(second, scoreAll(9), { now: lateNight });
    expect(kept(second)).toBe(5);
    expect(second.calls.filter((c) => c.startsWith("delete")).length).toBe(5);
    expect(state().kept).toBe(DAILY_BUDGET);
    const over = ledger().filter((e) => e.why.startsWith("over daily budget"));
    expect(over.map((e) => e.action)).toEqual(Array(5).fill("delete"));
  });

  test("the count resets at midnight Pacific", async () => {
    fs.writeFileSync(statePath, JSON.stringify({ watermark: WATERMARK.toISOString(), day: "2026-10-26", kept: DAILY_BUDGET }));
    const reader = new MockReader(docs("c", 3));
    await go(reader, scoreAll(9), { now: afterMidnight });
    expect(kept(reader)).toBe(3);
    expect(state()).toMatchObject({ day: "2026-10-27", kept: 3 });
  });

  test("the highest scores win within a run", async () => {
    fs.writeFileSync(statePath, JSON.stringify({ watermark: WATERMARK.toISOString(), day: "2026-10-26", kept: DAILY_BUDGET - 2 }));
    const scores: Record<string, number> = { lo: KEEP_THRESHOLD, mid: 8, hi: 10, top: 9 };
    const reader = new MockReader(Object.keys(scores).map((id) => doc({ id })));
    await go(reader, async (ds) => ds.map((d) => ({ score: scores[d.id]!, why: d.id })), { now: morning });
    expect(reader.calls.filter((c) => c.startsWith("update")).map((c) => c.split(" ")[1])).toEqual(["hi", "top"]);
    expect(reader.calls).toContain("delete mid");
    expect(reader.calls).toContain("delete lo");
  });

  test("a run that keeps nothing leaves the counter alone", async () => {
    fs.writeFileSync(statePath, JSON.stringify({ watermark: WATERMARK.toISOString(), day: "2026-10-25", kept: 7 }));
    const reader = new MockReader(docs("d", 3));
    await go(reader, scoreAll(0), { now: morning });
    expect(kept(reader)).toBe(0);
    expect(state()).toMatchObject({ day: "2026-10-25", kept: 7 });
    expect(state().watermark).not.toBe(WATERMARK.toISOString());
  });
});

describe("duplicates within a run", () => {
  test("keeps the higher-scored copy and deletes the other as a duplicate", async () => {
    const scores: Record<string, number> = { lo: 6, hi: 9, mirror: 8, other: 7 };
    const reader = new MockReader([
      doc({ id: "lo", source_url: "https://www.avabear.xyz/p/best-practices/?utm_source=rss", title: "best practices" }),
      doc({ id: "hi", source_url: "https://avabear.xyz/p/best-practices", title: "best practices" }),
      doc({ id: "mirror", source_url: "https://thezvi.wordpress.com/2026/10/26/x/", title: "Gemini 4: The Model" }),
      doc({ id: "other", source_url: "https://thezvi.substack.com/p/x", title: "Gemini 4 — the model" }),
    ]);
    await go(reader, async (ds) => ds.map((d) => ({ score: scores[d.id]!, why: d.id })));
    expect(reader.calls.filter((c) => c.startsWith("update")).map((c) => c.split(" ")[1])).toEqual(["hi", "mirror"]);
    expect(reader.calls).toContain("delete lo");
    expect(reader.calls).toContain("delete other");
    expect(ledger().find((e) => e.id === "lo")).toMatchObject({ decision: "drop", why: "duplicate of hi" });
    expect(ledger().find((e) => e.id === "other")).toMatchObject({ decision: "drop", why: "duplicate of mirror" });
  });

  test("dedupeKeys keeps the YouTube video id and ignores mailto urls", () => {
    expect(dedupeKeys(doc({ source_url: "https://www.youtube.com/watch?v=AoKo", title: null }))).toEqual(["url:youtube.com/watch?v=AoKo"]);
    expect(dedupeKeys(doc({ source_url: "mailto:reader-forwarded-email/abc", title: "Hi!" }))).toEqual(["title:hi"]);
  });
});

describe("taste from the Fascinations note", () => {
  const note = `# Fascinations
Preamble about the note.

## Now
Power and the egregore.

## Lately
- read a thing about bread

## Long questions
1. Can love and attraction coexist?

## Taste
Arguments, not news.

## Archive
old stuff
`;

  test("extracts Now, Long questions and Taste, and excludes Lately", () => {
    const taste = extractTaste(note);
    expect(taste).toBe("## Now\nPower and the egregore.\n\n## Long questions\n1. Can love and attraction coexist?\n\n## Taste\nArguments, not news.");
    expect(taste).not.toContain("Lately");
    expect(taste).not.toContain("bread");
    expect(taste).not.toContain("Preamble");
    expect(taste).not.toContain("old stuff");
  });

  test("the judge receives the extracted sections, read fresh each run", async () => {
    fs.writeFileSync(tastePath, note);
    let seen = "";
    const judge: Judge = async (docs, _ex, taste) => {
      seen = taste;
      return docs.map(() => ({ score: 9, why: "y" }));
    };
    await go(new MockReader([doc()]), judge);
    expect(seen).toBe(extractTaste(note));
    fs.writeFileSync(tastePath, "## Taste\nEdited.\n");
    await go(new MockReader([doc()]), judge, { since: WATERMARK });
    expect(seen).toBe("## Taste\nEdited.");
  });

  for (const [name, setup] of [
    ["missing file", () => fs.rmSync(tastePath)],
    ["empty sections", () => fs.writeFileSync(tastePath, "## Now\n\n## Lately\n- only this\n## Taste\n  \n")],
  ] as const) {
    test(`${name} skips the run with zero deletes and holds the watermark`, async () => {
      setup();
      const before = fs.readFileSync(statePath, "utf8");
      const reader = new MockReader([doc(), doc(), doc({ source_url: "https://youtube.com/shorts/x" })]);
      let judged = 0;
      const result = await go(reader, async (docs) => {
        judged += docs.length;
        return docs.map(() => ({ score: 0, why: "n" }));
      });
      expect(reader.calls).toEqual([]);
      expect(judged).toBe(0);
      expect(result.judged).toBe(0);
      expect(ledger()).toEqual([]);
      expect(fs.readFileSync(statePath, "utf8")).toBe(before);
    });
  }
});
