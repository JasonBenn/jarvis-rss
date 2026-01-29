#!/usr/bin/env bun
/**
 * Generate a categorized OPML file from classified feeds.
 *
 * This reads the classified feeds JSON and outputs an OPML file
 * organized by category folders for import into Readwise Reader.
 *
 * Usage: bun scripts/generate-opml.ts
 */

import * as fs from "fs";

const INPUT_PATH = "scripts/classified-feeds.json";
const OUTPUT_PATH = "exports/categorized-feeds.opml";

interface ClassifiedFeed {
  title: string;
  xmlUrl: string;
  existingCategory: string;
  domain: string;
  feedType: string;
  youtubeChannelId?: string;
  resolvedTitle?: string;
  category: string;
  displayTitle: string;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function generateOPML(feeds: ClassifiedFeed[], title: string = "Categorized RSS Feeds"): string {
  // Group feeds by category
  const feedsByCategory = new Map<string, ClassifiedFeed[]>();
  for (const feed of feeds) {
    const cat = feed.category || "Other";
    if (!feedsByCategory.has(cat)) {
      feedsByCategory.set(cat, []);
    }
    feedsByCategory.get(cat)!.push(feed);
  }

  // Sort categories alphabetically, but put "Other" at the end
  const sortedCategories = [...feedsByCategory.keys()].sort((a, b) => {
    if (a === "Other") return 1;
    if (b === "Other") return -1;
    return a.localeCompare(b);
  });

  // Build XML
  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push('<opml version="2.0">');
  lines.push("  <head>");
  lines.push(`    <title>${escapeXml(title)}</title>`);
  lines.push(`    <dateModified>${new Date().toISOString()}</dateModified>`);
  lines.push("  </head>");
  lines.push("  <body>");

  for (const category of sortedCategories) {
    const categoryFeeds = feedsByCategory.get(category)!;

    // Sort feeds within category alphabetically by display title
    categoryFeeds.sort((a, b) => a.displayTitle.localeCompare(b.displayTitle));

    lines.push(`    <outline text="${escapeXml(category)}" title="${escapeXml(category)}">`);

    for (const feed of categoryFeeds) {
      // Use display title (which includes resolved YouTube names)
      const feedTitle = feed.displayTitle || feed.domain;
      const attrs: string[] = [];
      attrs.push(`type="rss"`);
      attrs.push(`text="${escapeXml(feedTitle)}"`);
      attrs.push(`title="${escapeXml(feedTitle)}"`);
      attrs.push(`xmlUrl="${escapeXml(feed.xmlUrl)}"`);

      lines.push(`      <outline ${attrs.join(" ")} />`);
    }

    lines.push("    </outline>");
  }

  lines.push("  </body>");
  lines.push("</opml>");

  return lines.join("\n");
}

async function main() {
  console.log("Loading classified feeds...");
  const data = JSON.parse(fs.readFileSync(INPUT_PATH, "utf8"));
  const feeds: ClassifiedFeed[] = data.feeds;

  console.log(`Loaded ${feeds.length} feeds`);
  console.log(`Categories: ${data.categories.map((c: any) => c.name).join(", ")}`);

  // Generate OPML
  const opml = generateOPML(feeds, "Categorized RSS Feeds");

  // Ensure exports directory exists
  if (!fs.existsSync("exports")) {
    fs.mkdirSync("exports", { recursive: true });
  }

  fs.writeFileSync(OUTPUT_PATH, opml);
  console.log(`\nOPML written to: ${OUTPUT_PATH}`);
  console.log(`Total feeds: ${feeds.length}`);
  console.log(`Categories: ${data.categories.length}`);

  // Summary
  console.log("\nCategory summary:");
  for (const cat of data.categories) {
    console.log(`  ${cat.name}: ${cat.count} feeds`);
  }
}

main().catch(console.error);
