#!/usr/bin/env bun
/**
 * Analyze feeds from Readwise OPML and reading engagement from CSV.
 *
 * This script:
 * 1. Parses the OPML to get all feeds
 * 2. Parses the CSV to compute per-domain engagement
 * 3. For YouTube "Videos" entries, fetches the feed to get channel name
 * 4. Outputs JSON with all feed data for classification
 *
 * Usage: bun scripts/analyze-feeds.ts
 */

import { XMLParser } from "fast-xml-parser";
import * as fs from "fs";
import { parse } from "csv-parse/sync";

// Input files
const OPML_PATH = "/Users/jasonbenn/Downloads/Reader_Feeds.opml";
const CSV_PATH = "/Users/jasonbenn/Downloads/export (1).csv";
const OUTPUT_PATH = "scripts/feed-analysis.json";

interface Feed {
  title: string;
  xmlUrl: string;
  category: string;
  type: string;
}

interface ReadingItem {
  title: string;
  url: string;
  progress: number;
  location: string;
  savedDate: string;
}

interface DomainStats {
  domain: string;
  totalSaved: number;
  totalRead: number;
  sampleTitles: string[];
}

interface AnalyzedFeed {
  title: string;
  xmlUrl: string;
  existingCategory: string;
  domain: string;
  feedType: "blog" | "substack" | "youtube" | "podcast" | "other";
  youtubeChannelId?: string;
  resolvedTitle?: string;  // For YouTube feeds where title was "Videos"
  engagement: {
    totalSaved: number;
    totalRead: number;
    sampleReadTitles: string[];
  };
}

function parseOPML(filePath: string): Feed[] {
  const content = fs.readFileSync(filePath, "utf8");
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "",
    parseAttributeValue: false,
    trimValues: true,
  });
  const result = parser.parse(content);

  const feeds: Feed[] = [];
  const body = result.opml.body;
  const topOutlines = Array.isArray(body.outline) ? body.outline : [body.outline];

  for (const outline of topOutlines) {
    if (!outline) continue;

    // Check if this is a container (like "Feeds") with nested outlines
    if (outline.outline) {
      const nested = Array.isArray(outline.outline) ? outline.outline : [outline.outline];
      for (const feed of nested) {
        if (!feed || !feed.xmlUrl) continue;
        feeds.push({
          title: feed.title || "",
          xmlUrl: feed.xmlUrl,
          category: feed.category || "",
          type: feed.type || "rss",
        });
      }
    } else if (outline.xmlUrl) {
      // Direct feed at top level
      feeds.push({
        title: outline.title || "",
        xmlUrl: outline.xmlUrl,
        category: outline.category || "",
        type: outline.type || "rss",
      });
    }
  }

  return feeds;
}

function parseCSV(filePath: string): ReadingItem[] {
  const content = fs.readFileSync(filePath, "utf8");
  const records = parse(content, {
    columns: true,
    skip_empty_lines: true,
    relaxQuotes: true,
  });

  return records.map((row: any) => ({
    title: row.Title || "",
    url: row.URL || "",
    progress: parseFloat(row["Reading progress"] || "0"),
    location: row.Location || "",
    savedDate: row["Saved date"] || "",
  }));
}

function extractDomain(url: string): string {
  try {
    const parsed = new URL(url);
    let domain = parsed.hostname.replace(/^www\./, "");

    // Normalize substack domains
    if (domain.endsWith(".substack.com")) {
      return domain;
    }

    // Normalize YouTube
    if (domain === "youtube.com" || domain === "youtu.be") {
      return "youtube.com";
    }

    return domain;
  } catch {
    return "";
  }
}

function extractYouTubeChannelId(xmlUrl: string): string | null {
  // Extract from playlist_id (UULF format)
  const playlistMatch = xmlUrl.match(/playlist_id=UULF([a-zA-Z0-9_-]+)/);
  if (playlistMatch) {
    return "UC" + playlistMatch[1];
  }

  // Extract from channel_id
  const channelMatch = xmlUrl.match(/channel_id=(UC[a-zA-Z0-9_-]+)/);
  if (channelMatch) {
    return channelMatch[1];
  }

  return null;
}

function determineFeedType(xmlUrl: string): "blog" | "substack" | "youtube" | "podcast" | "other" {
  if (xmlUrl.includes("youtube.com")) return "youtube";
  if (xmlUrl.includes("substack.com") || xmlUrl.includes(".substack.")) return "substack";
  if (xmlUrl.includes("anchor.fm") || xmlUrl.includes("podcasts.apple") ||
      xmlUrl.includes("acast.com") || xmlUrl.includes("libsyn.com") ||
      xmlUrl.includes("rss.art19.com") || xmlUrl.includes("omnycontent.com")) return "podcast";
  return "blog";
}

async function fetchYouTubeChannelName(xmlUrl: string): Promise<string | null> {
  try {
    const response = await fetch(xmlUrl, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) return null;

    const text = await response.text();
    // Extract channel name from <author><name>
    const match = text.match(/<author>\s*<name>([^<]+)<\/name>/);
    return match ? match[1].trim() : null;
  } catch {
    return null;
  }
}

function computeDomainStats(items: ReadingItem[]): Map<string, DomainStats> {
  const stats = new Map<string, DomainStats>();

  for (const item of items) {
    const domain = extractDomain(item.url);
    if (!domain) continue;

    if (!stats.has(domain)) {
      stats.set(domain, {
        domain,
        totalSaved: 0,
        totalRead: 0,
        sampleTitles: [],
      });
    }

    const stat = stats.get(domain)!;
    stat.totalSaved++;

    // Consider "read" if archived or >= 50% progress
    const isRead = item.location === "archive" || item.progress >= 0.5;
    if (isRead) {
      stat.totalRead++;
      if (stat.sampleTitles.length < 5) {
        stat.sampleTitles.push(item.title);
      }
    }
  }

  return stats;
}

function matchFeedToDomain(xmlUrl: string, domainStats: Map<string, DomainStats>): DomainStats | null {
  const feedDomain = extractDomain(xmlUrl);
  if (!feedDomain) return null;

  // Direct match
  if (domainStats.has(feedDomain)) {
    return domainStats.get(feedDomain)!;
  }

  // For substack, try matching the subdomain
  if (feedDomain.endsWith(".substack.com")) {
    // The CSV might have URLs like substack.com/inbox/... or similar
    for (const [domain, stats] of domainStats) {
      if (domain === feedDomain || domain.includes(feedDomain.split(".")[0])) {
        return stats;
      }
    }
  }

  return null;
}

async function main() {
  console.log("Parsing OPML...");
  const feeds = parseOPML(OPML_PATH);
  console.log(`Found ${feeds.length} feeds`);

  console.log("\nParsing CSV...");
  const items = parseCSV(CSV_PATH);
  console.log(`Found ${items.length} reading items`);

  // Count read items
  const readItems = items.filter(i => i.location === "archive" || i.progress >= 0.5);
  console.log(`Items read (archived or >=50% progress): ${readItems.length}`);

  console.log("\nComputing domain stats...");
  const domainStats = computeDomainStats(items);
  console.log(`Unique domains with reading data: ${domainStats.size}`);

  // Analyze feeds
  console.log("\nAnalyzing feeds...");
  const analyzedFeeds: AnalyzedFeed[] = [];

  // Find YouTube feeds that need name resolution
  const youtubeVideosFeeds = feeds.filter(f =>
    f.title === "Videos" && f.xmlUrl.includes("youtube.com")
  );
  console.log(`YouTube "Videos" feeds to resolve: ${youtubeVideosFeeds.length}`);

  // Resolve YouTube channel names in batches
  const channelNames = new Map<string, string>();
  if (youtubeVideosFeeds.length > 0) {
    console.log("Fetching YouTube channel names (this may take a moment)...");

    // Process in batches of 10
    const batchSize = 10;
    for (let i = 0; i < youtubeVideosFeeds.length; i += batchSize) {
      const batch = youtubeVideosFeeds.slice(i, i + batchSize);
      const promises = batch.map(async (feed) => {
        const name = await fetchYouTubeChannelName(feed.xmlUrl);
        if (name) {
          channelNames.set(feed.xmlUrl, name);
        }
      });
      await Promise.all(promises);
      process.stdout.write(`  ${Math.min(i + batchSize, youtubeVideosFeeds.length)}/${youtubeVideosFeeds.length}\r`);
    }
    console.log(`\nResolved ${channelNames.size} YouTube channel names`);
  }

  // Build analyzed feed list
  for (const feed of feeds) {
    const feedType = determineFeedType(feed.xmlUrl);
    const domain = extractDomain(feed.xmlUrl);
    const stats = matchFeedToDomain(feed.xmlUrl, domainStats);

    const analyzed: AnalyzedFeed = {
      title: feed.title,
      xmlUrl: feed.xmlUrl,
      existingCategory: feed.category,
      domain,
      feedType,
      engagement: {
        totalSaved: stats?.totalSaved || 0,
        totalRead: stats?.totalRead || 0,
        sampleReadTitles: stats?.sampleTitles || [],
      },
    };

    if (feedType === "youtube") {
      analyzed.youtubeChannelId = extractYouTubeChannelId(feed.xmlUrl) || undefined;
      if (feed.title === "Videos") {
        analyzed.resolvedTitle = channelNames.get(feed.xmlUrl) || undefined;
      }
    }

    analyzedFeeds.push(analyzed);
  }

  // Summary stats
  const categories = new Map<string, number>();
  for (const feed of analyzedFeeds) {
    const cat = feed.existingCategory || "(uncategorized)";
    categories.set(cat, (categories.get(cat) || 0) + 1);
  }

  console.log("\nExisting categories:");
  for (const [cat, count] of [...categories.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${cat}: ${count}`);
  }

  // Feed types
  const feedTypes = new Map<string, number>();
  for (const feed of analyzedFeeds) {
    feedTypes.set(feed.feedType, (feedTypes.get(feed.feedType) || 0) + 1);
  }

  console.log("\nFeed types:");
  for (const [type, count] of [...feedTypes.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${type}: ${count}`);
  }

  // Write output
  const output = {
    generatedAt: new Date().toISOString(),
    totalFeeds: analyzedFeeds.length,
    feeds: analyzedFeeds,
  };

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));
  console.log(`\nOutput written to: ${OUTPUT_PATH}`);
}

main().catch(console.error);
