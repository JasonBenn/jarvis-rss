#!/usr/bin/env bun
/**
 * Fetch Twitter list digests from Readwise, classify tweets with Haiku,
 * and save to cache for RSS generation.
 *
 * Run manually: bun run scripts/classify-twitter.ts
 * Cron: 30 8,20 * * * cd /opt/jarvis-rss && bun run twitter
 */

import {
  fetchReadwiseDigests,
  parseTweetsFromDocument,
  classifyTweets,
  loadCache,
  saveCache,
  mergeTweets,
  getCategoryStats,
} from "../src/twitter";
import type { Tweet } from "../src/twitter";

async function main() {
  console.log("=== Twitter Classification Pipeline ===");
  console.log(`Started at: ${new Date().toISOString()}\n`);

  // Load existing cache
  const cache = loadCache();
  const existingTweets = cache?.tweets || [];
  console.log(`Loaded ${existingTweets.length} tweets from cache`);

  // Fetch new digests from Readwise
  console.log("\nFetching Twitter digests from Readwise...");
  let documents;
  try {
    documents = await fetchReadwiseDigests();
    console.log(`Found ${documents.length} digest(s)`);
    for (const doc of documents) {
      console.log(`  - ${doc.title}`);
    }
  } catch (error) {
    console.error("Failed to fetch digests:", error);
    process.exit(1);
  }

  if (documents.length === 0) {
    console.log("No new digests found. Exiting.");
    return;
  }

  // Parse tweets from HTML
  console.log("\nParsing tweets from digests...");
  const parsedTweets: Omit<Tweet, "category">[] = [];
  for (const doc of documents) {
    const tweets = parseTweetsFromDocument(doc);
    console.log(`  ${doc.title}: ${tweets.length} tweets`);
    parsedTweets.push(...tweets);
  }
  console.log(`Total parsed: ${parsedTweets.length} tweets`);

  if (parsedTweets.length === 0) {
    console.log("No tweets parsed. Check the HTML parsing logic.");
    return;
  }

  // Filter out already-classified tweets
  const existingIds = new Set(existingTweets.map((t) => t.id));
  const newTweets = parsedTweets.filter((t) => !existingIds.has(t.id));
  console.log(`${newTweets.length} new tweets to classify`);

  if (newTweets.length === 0) {
    console.log("All tweets already classified. Exiting.");
    return;
  }

  // Classify new tweets with Haiku
  console.log("\nClassifying tweets with Haiku...");
  let classifiedNew: Tweet[];
  try {
    classifiedNew = await classifyTweets(newTweets);
    console.log(`Classified ${classifiedNew.length} tweets`);
  } catch (error) {
    console.error("Failed to classify tweets:", error);
    process.exit(1);
  }

  // Merge with existing and save
  const allTweets = mergeTweets(existingTweets, classifiedNew);
  console.log(`\nTotal tweets after merge: ${allTweets.length}`);

  saveCache(allTweets);
  console.log("Cache saved to data/classified-tweets.json");

  // Print stats
  const stats = getCategoryStats(allTweets);
  console.log("\nCategory distribution:");
  for (const { category, count } of stats) {
    console.log(`  ${category}: ${count}`);
  }

  console.log(`\nCompleted at: ${new Date().toISOString()}`);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
