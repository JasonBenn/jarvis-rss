#!/usr/bin/env bun
import * as fs from "fs";
import * as path from "path";
import { parseOPML, feedsToTable, slugify } from "./opml";
import { parseSyntheticFile, listSyntheticFeeds } from "./synthetic";

const command = process.argv[2];

function usage() {
  console.log(`
jarvis-rss CLI

Commands:
  list              List all feeds with URLs
  opml              Output the OPML file
  validate          Validate OPML and synthetic files
  categories        List feed categories
  synthetic         List synthetic feeds and their items

Examples:
  bun run feeds:list
  bun run opml
  bun run feeds:validate
`);
}

async function outputOpml() {
  try {
    const content = fs.readFileSync("feeds.opml", "utf8");
    console.log(content);
  } catch (error) {
    console.error("Failed to read feeds.opml:", error);
    process.exit(1);
  }
}

async function listFeeds() {
  try {
    const { feeds, categories } = parseOPML("feeds.opml");
    console.log("Preview: https://rss.jasonbenn.com/preview");
    console.log(feedsToTable(feeds, categories));
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

      // Check synthetic feeds have their files
      if (feed.type === "synthetic" && feed.syntheticFile) {
        const syntheticPath = path.join("synthetic", feed.syntheticFile);
        if (!fs.existsSync(syntheticPath)) {
          console.error(`  [ERROR] ${feed.text}: missing synthetic file: ${syntheticPath}`);
          errors++;
        } else {
          // Validate synthetic file format
          try {
            const data = parseSyntheticFile(syntheticPath);
            if (!data.title) {
              console.warn(`  [WARN] ${feed.syntheticFile}: missing title`);
              warnings++;
            }
            if (data.items.length === 0) {
              console.warn(`  [WARN] ${feed.syntheticFile}: no items defined`);
              warnings++;
            }
            console.log(`  [OK] ${feed.text}: ${data.items.length} items in synthetic feed`);
          } catch (e) {
            console.error(`  [ERROR] ${feed.syntheticFile}: failed to parse`);
            errors++;
          }
        }
      }

      // Check RSS feeds have xmlUrl
      if (feed.type === "rss" && !feed.xmlUrl) {
        console.error(`  [ERROR] ${feed.text}: RSS feed missing xmlUrl`);
        errors++;
      }
    }

    // Check for orphaned synthetic files
    const syntheticFiles = listSyntheticFeeds();
    const referencedFiles = new Set(
      feeds
        .filter((f) => f.syntheticFile)
        .map((f) => f.syntheticFile!.replace(".md", ""))
    );

    for (const file of syntheticFiles) {
      if (!referencedFiles.has(file)) {
        console.warn(`  [WARN] Orphaned synthetic file: synthetic/${file}.md`);
        warnings++;
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

async function listSynthetic() {
  const syntheticDir = "synthetic";
  if (!fs.existsSync(syntheticDir)) {
    console.log("No synthetic directory found");
    return;
  }

  const files = listSyntheticFeeds();
  if (files.length === 0) {
    console.log("No synthetic feeds found");
    return;
  }

  console.log("Synthetic Feeds:\n");

  for (const slug of files) {
    const filePath = path.join(syntheticDir, `${slug}.md`);
    try {
      const data = parseSyntheticFile(filePath);
      const now = new Date();
      const publishedItems = data.items.filter(
        (i) => new Date(i.published) <= now
      );
      const upcomingItems = data.items.filter(
        (i) => new Date(i.published) > now
      );

      console.log(`${data.title}`);
      console.log(`  Slug: ${slug}`);
      console.log(`  Items: ${publishedItems.length} published, ${upcomingItems.length} upcoming`);

      if (upcomingItems.length > 0) {
        const next = upcomingItems[0];
        console.log(`  Next: "${next.title}" on ${next.published}`);
      }
      console.log("");
    } catch (e) {
      console.error(`Failed to parse ${slug}: ${e}`);
    }
  }
}

// Main
switch (command) {
  case "list":
    await listFeeds();
    break;
  case "opml":
    await outputOpml();
    break;
  case "validate":
    await validate();
    break;
  case "categories":
    await listCategories();
    break;
  case "synthetic":
    await listSynthetic();
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
