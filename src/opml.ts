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

export function feedsToTable(
  feeds: FeedOutline[],
  categories: string[],
  exportedIn?: Map<string, string>
): string {
  // Calculate column widths across all feeds
  const getExport = (f: FeedOutline) => (exportedIn?.get(f.xmlUrl || "") || "-");
  const allRows = feeds.map((f) => [f.text, getFeedUrl(f), getExport(f)]);
  const header = ["Name", "URL", "Exported"];
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
      lines.push(formatRow([feed.text, getFeedUrl(feed), getExport(feed)]));
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

/**
 * Generate OPML 2.0 XML from a list of feeds.
 * Groups feeds by category and only includes categories that have feeds.
 */
export function generateOPML(feeds: FeedOutline[], title: string = "RSS Feeds"): string {
  // Group feeds by category
  const feedsByCategory = new Map<string, FeedOutline[]>();
  for (const feed of feeds) {
    const cat = feed.category || "Uncategorized";
    if (!feedsByCategory.has(cat)) {
      feedsByCategory.set(cat, []);
    }
    feedsByCategory.get(cat)!.push(feed);
  }

  // Build feed outline attributes
  const feedToAttrs = (feed: FeedOutline): string => {
    const attrs: string[] = [];
    attrs.push(`type="${feed.type}"`);
    attrs.push(`text="${escapeXml(feed.text)}"`);
    if (feed.xmlUrl) attrs.push(`xmlUrl="${escapeXml(feed.xmlUrl)}"`);
    if (feed.sourceUrl) attrs.push(`sourceUrl="${escapeXml(feed.sourceUrl)}"`);
    if (feed.htmlUrl) attrs.push(`htmlUrl="${escapeXml(feed.htmlUrl)}"`);
    if (feed.author) attrs.push(`author="${escapeXml(feed.author)}"`);
    if (feed.frequency) attrs.push(`frequency="${escapeXml(feed.frequency)}"`);
    if (feed.vibe) attrs.push(`vibe="${escapeXml(feed.vibe)}"`);
    if (feed.syntheticFile) attrs.push(`syntheticFile="${escapeXml(feed.syntheticFile)}"`);
    return attrs.join(" ");
  };

  // Build XML
  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push('<opml version="2.0">');
  lines.push("  <head>");
  lines.push(`    <title>${escapeXml(title)}</title>`);
  lines.push(`    <dateModified>${new Date().toISOString()}</dateModified>`);
  lines.push("  </head>");
  lines.push("  <body>");

  for (const [category, categoryFeeds] of feedsByCategory) {
    lines.push(`    <outline text="${escapeXml(category)}" title="${escapeXml(category)}">`);
    for (const feed of categoryFeeds) {
      lines.push(`      <outline ${feedToAttrs(feed)} />`);
    }
    lines.push("    </outline>");
  }

  lines.push("  </body>");
  lines.push("</opml>");

  return lines.join("\n");
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Extract all xmlUrl values from an OPML file.
 */
export function extractFeedUrls(filePath: string): Set<string> {
  const urls = new Set<string>();
  try {
    const { feeds } = parseOPML(filePath);
    for (const feed of feeds) {
      if (feed.xmlUrl) {
        urls.add(feed.xmlUrl);
      }
    }
  } catch {
    // File might not exist or be invalid, return empty set
  }
  return urls;
}
