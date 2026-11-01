import { describe, expect, test } from "bun:test";
import { stubReason, isPaidStub } from "./paywall";
import type { Doc } from "./filter";

const PAID = "<p>Some free paragraphs about the election.</p><p><a href='https://x.substack.com/p/a'>Read more</a></p>";

const doc = (over: Partial<Doc> & { html_content?: string | null } = {}) => ({
  id: "x",
  url: "",
  source_url: "https://news.example/p/a",
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
  saved_at: "2026-10-01T00:00:00Z",
  html_content: PAID,
  ...over,
});

describe("paywall stub rule", () => {
  test("a body ending in Read more or a paid-subscriber notice is a stub", () => {
    expect(stubReason(doc())).toContain("Read more");
    expect(stubReason(doc({ html_content: "<p>Intro.</p><p>This post is for paid subscribers</p>" }))).not.toBeNull();
    expect(stubReason(doc({ html_content: "<p>Intro.</p><p>This part of the conversation is reserved for paying subscribers… Read more</p>" }))).not.toBeNull();
    expect(stubReason(doc({ html_content: "<p>The rest of this post is available for free if you are a subscriber; consider becoming a free or paid subscriber. Read more</p>" }))).not.toBeNull();
  });

  test("full posts, short posts and subscribe buttons are not stubs", () => {
    expect(stubReason(doc({ html_content: "<p>A whole essay.</p><p>Subscribe now</p>" }))).toBeNull();
    expect(stubReason(doc({ html_content: "<p>Let it be.</p>" }))).toBeNull();
    expect(stubReason(doc({ html_content: "<p>I will read more books this year, I promised. Then I did other things.</p>" }))).toBeNull();
    expect(stubReason(doc({ html_content: null }))).toBeNull();
  });

  test("never YouTube, podcasts, emails, or full-text feeds (Foreign Affairs, Economist, the archive proxy)", () => {
    expect(stubReason(doc({ site_name: "YouTube", source_url: "https://www.youtube.com/watch?v=1" }))).toBeNull();
    expect(stubReason(doc({ category: "podcast" }))).toBeNull();
    expect(stubReason(doc({ category: "email", source_url: "mailto:reader-forwarded-email/x" }))).toBeNull();
    expect(stubReason(doc({ source_url: "https://www.foreignaffairs.com/ukraine/x" }))).toBeNull();
    expect(stubReason(doc({ source_url: "https://www.economist.com/leaders/x" }))).toBeNull();
    expect(stubReason(doc({ source_url: "https://rss.jasonbenn.com/archive?url=https%3A%2F%2Fwww.economist.com%2Fx" }))).toBeNull();
  });

  test("never touches opened, tagged, noted, progressed, or non-feed documents", () => {
    expect(stubReason(doc({ first_opened_at: "2026-10-02T00:00:00Z" }))).toBeNull();
    expect(stubReason(doc({ tags: { pick: {} } }))).toBeNull();
    expect(stubReason(doc({ notes: "keep" }))).toBeNull();
    expect(stubReason(doc({ reading_progress: 0.2 }))).toBeNull();
    expect(stubReason(doc({ location: "later" }))).toBeNull();
  });
});

describe("paid confirmation", () => {
  test("deletes a teaser only when Substack says the post is paid and Reader holds under 80% of it", () => {
    expect(isPaidStub({ ...doc(), word_count: 300 } as any, { audience: "only_paid", wordcount: 2400 })).toBe(true);
    expect(isPaidStub({ ...doc(), word_count: 300 } as any, { audience: "only_subscribers", wordcount: 2400 })).toBe(true);
    expect(isPaidStub({ ...doc(), word_count: 1600 } as any, { audience: "everyone", wordcount: 11700 })).toBe(false);
    expect(isPaidStub({ ...doc(), word_count: 8200 } as any, { audience: "only_paid", wordcount: 8800 })).toBe(false);
    expect(isPaidStub({ ...doc(), word_count: 300 } as any, null)).toBe(false);
  });
});
