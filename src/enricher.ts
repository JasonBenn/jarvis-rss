import { XMLParser, XMLBuilder } from "fast-xml-parser";

const parserOptions = {
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseTagValue: false,
  trimValues: true,
};

const builderOptions = {
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  format: true,
  cdataPropName: "__cdata",
};

interface RSSItem {
  title: string;
  link: string;
  description?: string;
  pubDate?: string;
  guid?: string | { "#text": string };
  [key: string]: unknown;
}

function getArchiveTodayUrl(url: string): string {
  // archive.today accepts raw URLs directly (no encoding needed)
  return `https://archive.today/${url}`;
}

function enrichDescription(
  originalDescription: string | undefined,
  articleUrl: string
): { __cdata: string } {
  const archiveLink = getArchiveTodayUrl(articleUrl);
  const archiveHtml = `<p><a href="${archiveLink}">[Archive link]</a></p>`;

  // Extract content from CDATA if present
  let content = originalDescription || "";
  if (typeof content === "object" && (content as any).__cdata) {
    content = (content as any).__cdata;
  }

  const enriched = content ? `${content}\n${archiveHtml}` : archiveHtml;

  // Return as CDATA to prevent XML escaping
  return { __cdata: enriched };
}

export async function enrichFeed(feedUrl: string): Promise<string> {
  // Fetch the original feed
  const response = await fetch(feedUrl, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; jarvis-rss/1.0; +https://jarvis-rss.fly.dev)",
      Accept: "application/rss+xml, application/xml, text/xml",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch feed: ${response.status} ${response.statusText}`);
  }

  const feedText = await response.text();
  const parser = new XMLParser(parserOptions);
  const feed = parser.parse(feedText);

  // Handle RSS 2.0 format
  if (feed.rss?.channel) {
    const channel = feed.rss.channel;
    const items = channel.item;

    if (items) {
      const itemArray = Array.isArray(items) ? items : [items];

      for (const item of itemArray) {
        const link = item.link;
        if (link) {
          item.description = enrichDescription(item.description, link);
        }
      }

      channel.item = itemArray;
    }

    // Add note that this is an enriched feed
    if (channel.description) {
      channel.description = `[Enriched by jarvis-rss] ${channel.description}`;
    }
  }

  // Handle Atom format
  if (feed.feed?.entry) {
    const entries = feed.feed.entry;
    const entryArray = Array.isArray(entries) ? entries : [entries];

    for (const entry of entryArray) {
      // Atom links can be in different formats
      let link = "";
      if (typeof entry.link === "string") {
        link = entry.link;
      } else if (entry.link?.["@_href"]) {
        link = entry.link["@_href"];
      } else if (Array.isArray(entry.link)) {
        const htmlLink = entry.link.find(
          (l: { "@_rel"?: string }) => l["@_rel"] === "alternate" || !l["@_rel"]
        );
        if (htmlLink?.["@_href"]) {
          link = htmlLink["@_href"];
        }
      }

      if (link) {
        if (entry.summary) {
          entry.summary = enrichDescription(entry.summary, link);
        } else if (entry.content) {
          const content =
            typeof entry.content === "string"
              ? entry.content
              : entry.content?.["#text"] || "";
          entry.content = enrichDescription(content, link);
        }
      }
    }

    feed.feed.entry = entryArray;
  }

  const builder = new XMLBuilder(builderOptions);
  return builder.build(feed);
}

// Simple in-memory cache for enriched feeds
const feedCache = new Map<string, { content: string; timestamp: number }>();
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

export async function enrichFeedCached(feedUrl: string): Promise<string> {
  const cached = feedCache.get(feedUrl);
  const now = Date.now();

  if (cached && now - cached.timestamp < CACHE_TTL_MS) {
    return cached.content;
  }

  const content = await enrichFeed(feedUrl);
  feedCache.set(feedUrl, { content, timestamp: now });

  return content;
}

export function clearFeedCache(): void {
  feedCache.clear();
}
