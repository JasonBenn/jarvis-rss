#!/usr/bin/env bun
import * as fs from "fs";
import * as path from "path";
import { parseOPML, feedsToTable, slugify, generateOPML, extractFeedUrls } from "./opml";

const command = process.argv[2];

const EXPORTS_DIR = "exports";

function usage() {
  console.log(`
jarvis-rss CLI

Commands:
  list              List all feeds with URLs
  opml              Export new feeds to OPML (incremental)
  validate          Validate OPML
  categories        List feed categories

Examples:
  bun run feeds:list
  bun run opml
  bun run feeds:validate
`);
}

async function exportOpml() {
  try {
    // Read current feeds
    const { feeds } = parseOPML("feeds.opml");

    // Ensure exports directory exists
    if (!fs.existsSync(EXPORTS_DIR)) {
      fs.mkdirSync(EXPORTS_DIR);
    }

    // Collect all previously exported URLs
    const exportedUrls = new Set<string>();
    const exportFiles = fs.readdirSync(EXPORTS_DIR).filter(f => f.endsWith(".opml"));
    for (const file of exportFiles) {
      const urls = extractFeedUrls(path.join(EXPORTS_DIR, file));
      for (const url of urls) {
        exportedUrls.add(url);
      }
    }

    // Filter to only new feeds (those not previously exported)
    const newFeeds = feeds.filter(feed => feed.xmlUrl && !exportedUrls.has(feed.xmlUrl));

    if (newFeeds.length === 0) {
      console.log("No new feeds to export.");
      console.log(`Previously exported: ${exportedUrls.size} feeds across ${exportFiles.length} files`);
      return;
    }

    // Generate OPML with only new feeds
    const opmlContent = generateOPML(newFeeds, "New RSS Feeds Export");

    // Save to exports directory with timestamped filename
    const now = new Date();
    const timestamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}-${String(now.getHours()).padStart(2, "0")}-${String(now.getMinutes()).padStart(2, "0")}`;
    const exportPath = path.join(EXPORTS_DIR, `feeds-${timestamp}.opml`);
    fs.writeFileSync(exportPath, opmlContent);

    console.log(`Exported ${newFeeds.length} new feed(s):`);
    for (const feed of newFeeds) {
      console.log(`  - ${feed.text}`);
    }
    console.log(`\nSaved to: ${exportPath}`);
  } catch (error) {
    console.error("Failed to export OPML:", error);
    process.exit(1);
  }
}

async function listFeeds() {
  try {
    const { feeds, categories } = parseOPML("feeds.opml");

    // Build map of feed URL -> export filename
    const exportedIn = new Map<string, string>();
    if (fs.existsSync(EXPORTS_DIR)) {
      const exportFiles = fs.readdirSync(EXPORTS_DIR).filter(f => f.endsWith(".opml"));
      for (const file of exportFiles) {
        const urls = extractFeedUrls(path.join(EXPORTS_DIR, file));
        for (const url of urls) {
          if (!exportedIn.has(url)) {
            exportedIn.set(url, file);
          }
        }
      }
    }

    console.log("Preview: https://rss.jasonbenn.com/preview");
    console.log(feedsToTable(feeds, categories, exportedIn));
    console.log(`\nTotal: ${feeds.length} feeds`);
  } catch (error) {
    console.error("Failed to parse feeds.opml:", error);
    process.exit(1);
  }
}

async function validate() {
  let errors = 0;
  let warnings = 0;

  try {
    const { feeds, categories } = parseOPML("feeds.opml");
    console.log(`Parsed feeds.opml: ${feeds.length} feeds in ${categories.length} categories\n`);

    // Check each feed
    for (const feed of feeds) {
      // Check required fields
      if (!feed.text) {
        console.error(`  [ERROR] Feed missing text/name`);
        errors++;
      }

      if (!feed.frequency) {
        console.warn(`  [WARN] ${feed.text}: missing frequency`);
        warnings++;
      }

      // Check RSS feeds have xmlUrl
      if (feed.type === "rss" && !feed.xmlUrl) {
        console.error(`  [ERROR] ${feed.text}: RSS feed missing xmlUrl`);
        errors++;
      }
    }

    console.log("");
    if (errors === 0 && warnings === 0) {
      console.log(`All ${feeds.length} feeds valid`);
    } else {
      console.log(`Validation complete: ${errors} errors, ${warnings} warnings`);
    }

    if (errors > 0) {
      process.exit(1);
    }
  } catch (error) {
    console.error("Failed to validate:", error);
    process.exit(1);
  }
}

async function listCategories() {
  try {
    const { feeds, categories } = parseOPML("feeds.opml");
    console.log("Categories:");
    for (const cat of categories) {
      const count = feeds.filter((f) => f.category === cat).length;
      console.log(`  ${cat}: ${count} feeds`);
    }
  } catch (error) {
    console.error("Failed to parse feeds.opml:", error);
    process.exit(1);
  }
}

// Main
switch (command) {
  case "list":
    await listFeeds();
    break;
  case "opml":
    await exportOpml();
    break;
  case "validate":
    await validate();
    break;
  case "categories":
    await listCategories();
    break;
  case "help":
  case "--help":
  case "-h":
  case undefined:
    usage();
    break;
  default:
    console.error(`Unknown command: ${command}`);
    usage();
    process.exit(1);
}
