import { describe, expect, test } from "bun:test";
import { sweepable, summarizeFeeds } from "./sweep";
import type { Doc } from "./filter";

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
