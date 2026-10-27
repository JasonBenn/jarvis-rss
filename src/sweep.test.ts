import { describe, expect, test, beforeEach } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { sweepable, summarizeFeeds, deleteAll, assertClassified, isSharedKey } from "./sweep";
import { HttpError, type Doc, type Reader, type LedgerEntry } from "./filter";

const doc = (over: Partial<Doc> = {}): Doc => ({
  id: "x",
  url: "",
  source_url: "https://news.example/a",
  title: "t",
  author: null,
  site_name: "news.example",
  summary: null,
  source: "Reader RSS",
  category: "rss",
  location: "feed",
  tags: {},
  notes: "",
  parent_id: null,
  reading_progress: 0,
  first_opened_at: null,
  last_opened_at: null,
  saved_at: "2025-01-01T00:00:00Z",
  ...over,
});

const classes = {
  "news.example": { class: "topical" as const, reason: "" },
  "noise.example": { class: "low" as const, reason: "" },
  "essays.example": { class: "timeless" as const, reason: "" },
};

describe("sweep delete rule", () => {
  test("deletes untouched docs from topical and low feeds only", () => {
    expect(sweepable(doc(), classes)).toBe(true);
    expect(sweepable(doc({ source_url: "https://noise.example/a" }), classes)).toBe(true);
    expect(sweepable(doc({ source_url: "https://essays.example/a" }), classes)).toBe(false);
    expect(sweepable(doc({ source_url: "https://unclassified.example/a" }), classes)).toBe(false);
  });

  test.each([
    ["opened", { first_opened_at: "2025-01-02T00:00:00Z" }],
    ["last opened", { last_opened_at: "2025-01-02T00:00:00Z" }],
    ["progress", { reading_progress: 0.5 }],
    ["tagged", { tags: { a: {} } }],
    ["notes", { notes: "n" }],
    ["not in feed", { location: "later" }],
  ] as [string, Partial<Doc>][])("never deletes a doc that is %s", (_, over) => {
    expect(sweepable(doc(over), classes)).toBe(false);
  });

  test("summarizeFeeds counts opens per feed", () => {
    const [f] = summarizeFeeds([doc(), doc({ id: "y", first_opened_at: "2025-01-02T00:00:00Z" })]);
    expect(f).toMatchObject({ key: "news.example", count: 2, opened: 1 });
  });
});

describe("shared feed keys", () => {
  test("email and lumped hosts are never swept, even when classified", () => {
    expect(isSharedKey("email:Substack")).toBe(true);
    expect(isSharedKey("archive.today")).toBe(true);
    expect(isSharedKey("news.example")).toBe(false);
    const c = { "email:Substack": { class: "topical" as const, reason: "" } };
    expect(sweepable(doc({ source_url: "mailto:reader-forwarded-email/abc", author: "Substack" }), c)).toBe(false);
  });
});

describe("deleteAll", () => {
  let ledgerPath: string;
  beforeEach(() => {
    ledgerPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "sweep-")), "ledger.jsonl");
  });
  const ledger = (): LedgerEntry[] =>
    fs.existsSync(ledgerPath) ? fs.readFileSync(ledgerPath, "utf8").trim().split("\n").map((l) => JSON.parse(l)) : [];

  class MockReader implements Reader {
    calls: string[] = [];
    listParams: Record<string, string>[] = [];
    constructor(
      public changed: Doc[] = [],
      public fail: Record<string, number> = {},
    ) {}
    async list(params: Record<string, string>) {
      this.listParams.push(params);
      return this.changed;
    }
    async get() {
      return null;
    }
    async update() {}
    async delete(id: string) {
      this.calls.push(id);
      const status = this.fail[id];
      if (status) throw new HttpError(`DELETE ${id}: ${status}`, status);
    }
  }
  const run = (r: Reader, docs: Doc[]) => deleteAll(r, docs, "2026-10-26T00:00:00Z", ledgerPath, () => {});

  test("writes the ledger row, with both urls, before the delete call", async () => {
    const r = new MockReader();
    let rowsAtDelete = -1;
    const del = r.delete.bind(r);
    r.delete = async (id) => {
      rowsAtDelete = ledger().filter((e) => e.id === id).length;
      return del(id);
    };
    await run(r, [doc({ id: "a", url: "https://read.readwise.io/read/a" })]);
    expect(rowsAtDelete).toBe(1);
    expect(ledger()[0]).toMatchObject({ id: "a", action: "sweep-delete", url: "https://news.example/a", reader_url: "https://read.readwise.io/read/a" });
  });

  test("skips a doc that changed since the listing, in any location", async () => {
    const r = new MockReader([doc({ id: "moved", location: "later" })]);
    await run(r, [doc({ id: "moved" }), doc({ id: "b" })]);
    expect(r.calls).toEqual(["b"]);
    expect(r.listParams[0]).not.toHaveProperty("location");
    expect(ledger().map((e) => e.id)).toEqual(["b"]);
  });

  test("a 404 is already gone: marked sweep-gone, run continues", async () => {
    const r = new MockReader([], { a: 404 });
    await run(r, [doc({ id: "a" }), doc({ id: "b" })]);
    expect(r.calls).toEqual(["a", "b"]);
    expect(ledger().map((e) => `${e.id} ${e.action}`)).toEqual(["a sweep-delete", "a sweep-gone", "b sweep-delete"]);
  });

  test("a 403 aborts the whole run", async () => {
    const r = new MockReader([], { a: 403 });
    await expect(run(r, [doc({ id: "a" }), doc({ id: "b" })])).rejects.toThrow(/Sweep aborted at 1\/2.*403/);
    expect(r.calls).toEqual(["a"]);
  });

  test("an unclassified feed key refuses the run", () => {
    const feeds = summarizeFeeds([doc(), doc({ id: "n", source_url: "https://new.example/a" })]);
    expect(() => assertClassified(feeds, classes)).toThrow(/new\.example/);
    expect(() => assertClassified(summarizeFeeds([doc()]), classes)).not.toThrow();
  });
});
