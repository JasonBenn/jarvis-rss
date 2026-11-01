import { describe, expect, test } from "bun:test";
import { buildRows, exclusion, label, type ReaderDoc } from "./eval-set";
import { auc, capRows, metrics, split, type Scored } from "./eval";

const NOW = new Date("2026-10-31T12:00:00Z");
const none = { highlights: 0, highlightNotes: 0 };

function doc(over: Partial<ReaderDoc> = {}): ReaderDoc {
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
    saved_at: "2026-10-10T00:00:00Z",
    word_count: 2000,
    last_moved_at: null,
    ...over,
  };
}

const opened = (progress: number, at = "2026-10-20T00:00:00Z") => ({ reading_progress: progress, first_opened_at: at, last_opened_at: at });

describe("label", () => {
  test("any highlight is a strong like, even unread", () => {
    expect(label(doc(), { highlights: 1, highlightNotes: 0 }, NOW)?.label).toBe("strong_like");
  });

  test("a doc note is a strong like", () => {
    expect(label(doc({ notes: "good" }), none, NOW)?.label).toBe("strong_like");
  });

  test("read through in later is a strong like", () => {
    expect(label(doc({ location: "later", ...opened(0.95) }), none, NOW)?.label).toBe("strong_like");
  });

  test("hand-saved, read through, long is a like", () => {
    const d = doc({ source: "Reader Share Sheet iOS", location: "archive", ...opened(0.92) });
    expect(label(d, none, NOW)).toMatchObject({ label: "like" });
  });

  test("hand-saved but short and read through is not a like; falls to weak dislike", () => {
    const d = doc({ source: "Reader web", location: "archive", word_count: 600, ...opened(1) });
    expect(label(d, none, NOW)?.label).toBe("weak_dislike");
  });

  test("feed doc read to the end without engagement is a weak dislike", () => {
    expect(label(doc(opened(1)), none, NOW)?.label).toBe("weak_dislike");
  });

  test("abandoned midway more than 3 days ago is a dislike", () => {
    expect(label(doc(opened(0.3)), none, NOW)).toMatchObject({ label: "dislike", reason: expect.stringContaining("30%") });
  });

  test("abandoned but opened in the last 3 days is still in progress, unlabeled", () => {
    expect(label(doc(opened(0.3, "2026-10-30T00:00:00Z")), none, NOW)).toBeNull();
  });

  test("a tag of his own exempts a doc from dislike labels", () => {
    expect(label(doc({ ...opened(0.3), tags: { ai: {} } }), none, NOW)).toBeNull();
    expect(label(doc({ ...opened(1), tags: { ai: {} } }), none, NOW)).toBeNull();
  });

  test("the lead's pick tag does not exempt it", () => {
    expect(label(doc({ ...opened(0.3), source: "api", tags: { pick: {} } }), none, NOW)?.label).toBe("dislike");
  });

  test("an unopened lead pick is unlabeled", () => {
    expect(label(doc({ source: "api", tags: { pick: {} } }), none, NOW)).toBeNull();
  });

  test("unopened is never labeled, however old", () => {
    expect(label(doc({ saved_at: "2026-09-01T00:00:00Z" }), none, NOW)).toBeNull();
  });

  test("glanced at (under 5%) is unlabeled", () => {
    expect(label(doc(opened(0.02)), none, NOW)).toBeNull();
  });
});

describe("exclusion", () => {
  test("stubs, newsletters, video, podcasts and fresh saves are out", () => {
    expect(exclusion(doc({ word_count: 250 }), NOW)).toBe("under 300 words");
    expect(exclusion(doc({ word_count: null }), NOW)).toBe("under 300 words");
    expect(exclusion(doc({ category: "email" }), NOW)).toBe("email newsletter");
    expect(exclusion(doc({ source_url: "https://www.youtube.com/watch?v=1", site_name: "YouTube" }), NOW)).toBe("video or podcast");
    expect(exclusion(doc({ category: "podcast" }), NOW)).toBe("video or podcast");
    expect(exclusion(doc({ saved_at: "2026-10-30T00:00:00Z" }), NOW)).toBe("saved in the last 3 days");
    expect(exclusion(doc({ category: "epub" }), NOW)).toBe("book");
    expect(exclusion(doc({ source_url: "https://chatgpt.com/share/abc" }), NOW)).toBe("own upload or AI chat");
    expect(exclusion(doc(), NOW)).toBeNull();
  });
});

describe("buildRows", () => {
  test("counts highlights from highlight docs and records the rule", () => {
    const a = doc({ id: "a" });
    const h = doc({ id: "h", parent_id: "a", category: "highlight", notes: "note" });
    const rows = buildRows([a, doc({ id: "b", ...opened(0.3) })], [h], new Set(), NOW);
    expect(rows.map((r) => [r.id, r.label])).toEqual([
      ["a", "strong_like"],
      ["b", "dislike"],
    ]);
    expect(rows[0]!.metrics.highlight_notes).toBe(1);
    expect(rows[0]!.reason).toContain("1 highlights");
  });
});

describe("eval metrics", () => {
  const s = (label: Scored["label"], score: number): Scored => ({ id: Math.random().toString(), label, split: "train", score, why: "", title: "", feed: "", rss: true });

  test("precision and recall of keep against likes and dislikes; ", () => {
    const m = metrics([s("like", 8), s("strong_like", 2), s("dislike", 6), s("weak_dislike", 1)]);
    expect(m).toMatchObject({ tp: 1, fn: 1, fp: 1, tn: 1, precision: 0.5, recall: 0.5 });
  });

  test("auc is 1 when every like outscores every dislike, 0.5 on ties", () => {
    expect(auc([s("like", 8), s("dislike", 2), s("weak_dislike", 3)])).toBe(1);
    expect(auc([s("like", 4), s("dislike", 4)])).toBe(0.5);
  });

  test("split is stable and roughly 30% holdout", () => {
    const ids = Array.from({ length: 2000 }, (_, i) => `id${i}`);
    const holdout = ids.filter((id) => split(id) === "holdout").length / ids.length;
    expect(holdout).toBeGreaterThan(0.25);
    expect(holdout).toBeLessThan(0.35);
    expect(split("abc")).toBe(split("abc"));
  });

  test("cap samples each label in proportion", () => {
    const rows = [...Array(600)].map((_, i) => ({ id: `l${i}`, label: i < 400 ? "like" : "dislike" })) as never[];
    const capped = capRows(rows, 300) as { label: string }[];
    expect(capped.length).toBe(300);
    expect(capped.filter((r) => r.label === "like").length).toBe(200);
  });
});
