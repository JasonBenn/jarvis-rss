import { XMLParser, XMLBuilder } from "fast-xml-parser";
import * as fs from "fs";

export interface FeedOutline {
  type: "rss" | "synthetic" | "twitter-list";
  text: string;
  title?: string;
  xmlUrl?: string;
  sourceUrl?: string;  // Original feed URL (for enricher to fetch from)
  htmlUrl?: string;    // Site homepage (for favicon fetching)
  author?: string;
  frequency?: string;
  vibe?: string;
  syntheticFile?: string;
  category?: string;
}

export interface OPMLHead {
  title: string;
  dateModified: string;
  ownerName: string;
  enricherUrl?: string;
}

export interface ParsedOPML {
  head: OPMLHead;
  feeds: FeedOutline[];
  categories: string[];
}

const parserOptions = {
  ignoreAttributes: false,
  attributeNamePrefix: "",
  parseAttributeValue: false,
  trimValues: true,
};

export function parseOPML(filePath: string): ParsedOPML {
  const content = fs.readFileSync(filePath, "utf8");
  const parser = new XMLParser(parserOptions);
  const result = parser.parse(content);

  const head: OPMLHead = {
    title: result.opml.head.title || "",
    dateModified: result.opml.head.dateModified || "",
    ownerName: result.opml.head.ownerName || "",
    enricherUrl: result.opml.head.enricherUrl,
  };

  const feeds: FeedOutline[] = [];
  const categories: string[] = [];

  const body = result.opml.body;
  const topOutlines = Array.isArray(body.outline)
    ? body.outline
    : [body.outline];

  for (const category of topOutlines) {
    if (!category) continue;

    const categoryName = category.text || category.title || "Uncategorized";
    categories.push(categoryName);

    // Category folder with nested feeds
    if (category.outline) {
      const feedOutlines = Array.isArray(category.outline)
        ? category.outline
        : [category.outline];

      for (const feed of feedOutlines) {
        if (!feed) continue;
        feeds.push({
          type: feed.type || "rss",
          text: feed.text || "",
          title: feed.title,
          xmlUrl: feed.xmlUrl,
          sourceUrl: feed.sourceUrl,
          htmlUrl: feed.htmlUrl,
          author: feed.author,
          frequency: feed.frequency,
          vibe: feed.vibe,
          syntheticFile: feed.syntheticFile,
          category: categoryName,
        });
      }
    } else if (category.xmlUrl) {
      // Top-level feed (not in a category)
      feeds.push({
        type: category.type || "rss",
        text: category.text || "",
        title: category.title,
        xmlUrl: category.xmlUrl,
        sourceUrl: category.sourceUrl,
        htmlUrl: category.htmlUrl,
        author: category.author,
        frequency: category.frequency,
        vibe: category.vibe,
        syntheticFile: category.syntheticFile,
        category: "Uncategorized",
      });
    }
  }

  return { head, feeds, categories };
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

const BASE_URL = "https://rss.jasonbenn.com";

export function getFeedUrl(feed: FeedOutline): string {
  if (feed.type === "synthetic") {
    const slug = feed.syntheticFile?.replace(".md", "") || slugify(feed.text);
    return `${BASE_URL}/synthetic/${slug}`;
  }
  if (feed.enrichedUrl) {
    return feed.enrichedUrl;
  }
  return feed.xmlUrl || "";
}

export function feedsToTable(feeds: FeedOutline[], categories: string[]): string {
  // Calculate column widths across all feeds
  const allRows = feeds.map((f) => [f.text, getFeedUrl(f)]);
  const header = ["Name", "URL"];
  const widths = header.map((h, i) =>
    Math.max(h.length, ...allRows.map((r) => r[i].length))
  );

  const formatRow = (row: string[]) =>
    row.map((cell, i) => cell.padEnd(widths[i])).join(" | ");

  const lines: string[] = [];

  for (const category of categories) {
    const categoryFeeds = feeds.filter((f) => f.category === category);
    if (categoryFeeds.length === 0) continue;

    lines.push(`\n## ${category}`);
    for (const feed of categoryFeeds) {
      lines.push(formatRow([feed.text, getFeedUrl(feed)]));
    }
  }

  return lines.join("\n");
}

export function findFeedBySlug(
  feeds: FeedOutline[],
  slug: string
): FeedOutline | undefined {
  return feeds.find((f) => slugify(f.text) === slug);
}
