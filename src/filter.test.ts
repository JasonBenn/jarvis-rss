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
  type Doc,
  type Reader,
  type Judge,
  type LedgerEntry,
} from "./filter";

const WATERMARK = new Date("2026-10-26T00:00:00Z");

function doc(over: Partial<Doc> = {}): Doc {
  return {
    id: over.id ?? Math.random().toString(36).slice(2),
    url: "https://read.readwise.io/read/x",
    source_url: "https://example.com/essay",
    title: "An essay",
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
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "filter-"));
  statePath = path.join(dir, "state.json");
  ledgerPath = path.join(dir, "ledger.jsonl");
  fs.writeFileSync(statePath, JSON.stringify({ watermark: WATERMARK.toISOString() }));
});

const ledger = (): LedgerEntry[] =>
  fs.existsSync(ledgerPath)
    ? fs.readFileSync(ledgerPath, "utf8").trim().split("\n").map((l) => JSON.parse(l))
    : [];

const go = (reader: Reader, judge: Judge, extra: Partial<Parameters<typeof run>[0]> = {}) =>
  run({ reader, judge, statePath, ledgerPath, dryRun: false, log: () => {}, ...extra });

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
      `update keep1 ${JSON.stringify({ tags: ["pick"], summary: "on great love" })}`,
      "delete drop1",
    ]);
    const e = ledger().find((x) => x.id === "drop1")!;
    expect(Object.keys(e).sort()).toEqual(
      ["action", "author", "decision", "id", "model", "score", "site", "title", "ts", "url", "why"].sort(),
    );
    expect(e.action).toBe("delete");
    expect(e.url).toBe("https://example.com/essay");
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
  test("keeps at 7, drops at 6", async () => {
    const reader = new MockReader([doc({ id: "a" }), doc({ id: "b" })]);
    await go(reader, async (docs) => docs.map((d) => ({ score: d.id === "a" ? 7 : 6, why: "w" })));
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

describe("feed classes", () => {
  test("a low-class feed drops without a model call; others are judged", async () => {
    const low = doc({ id: "low", source_url: "https://noise.example/post" });
    const other = doc({ id: "ok", source_url: "https://essays.example/post" });
    const reader = new MockReader([low, other]);
    const judgedIds: string[] = [];
    await go(
      reader,
      async (docs) => {
        judgedIds.push(...docs.map((d) => d.id));
        return docs.map(() => ({ score: 9, why: "good" }));
      },
      { feedClasses: { "noise.example": { class: "low", reason: "thin" }, "essays.example": { class: "topical", reason: "x" } } },
    );
    expect(judgedIds).toEqual(["ok"]);
    expect(reader.calls).toContain("delete low");
  });

  test("feedKey groups by channel or publication", () => {
    expect(feedKey(doc({ site_name: "YouTube", author: "TED", source_url: "https://www.youtube.com/watch?v=1" }))).toBe("youtube:TED");
    expect(feedKey(doc({ source_url: "https://www.astralcodexten.com/p/x" }))).toBe("astralcodexten.com");
    expect(feedKey(doc({ source_url: "https://open.substack.com/pub/foo/p/x" }))).toBe("foo.substack.com");
    expect(feedKey(doc({ source_url: "https://substack.com/@bar/note/1" }))).toBe("bar.substack.com");
  });
});
