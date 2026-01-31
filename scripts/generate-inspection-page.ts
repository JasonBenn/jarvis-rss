#!/usr/bin/env bun
/**
 * Generate an HTML page for inspecting categorized tweets.
 * Groups tweets by category for easy quality evaluation.
 */

import * as fs from "fs";
import { CATEGORIES } from "../src/categories";
import type { Tweet } from "../src/twitter";

interface CacheData {
  updatedAt: string;
  tweets: Tweet[];
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function generateHtml(cache: CacheData): string {
  const { tweets, updatedAt } = cache;

  // Group tweets by category
  const byCategory = new Map<string, Tweet[]>();
  for (const cat of CATEGORIES) {
    byCategory.set(cat, []);
  }
  for (const tweet of tweets) {
    const cat = tweet.category || "Other";
    const list = byCategory.get(cat) || [];
    list.push(tweet);
    byCategory.set(cat, list);
  }

  // Sort categories by count (descending)
  const sortedCategories = [...byCategory.entries()]
    .filter(([_, tweets]) => tweets.length > 0)
    .sort((a, b) => b[1].length - a[1].length);

  const categoryNav = sortedCategories
    .map(
      ([cat, tweets]) =>
        `<a href="#${cat.replace(/[^a-z0-9]/gi, "-").toLowerCase()}" class="nav-link">${cat} (${tweets.length})</a>`
    )
    .join("");

  const categoryBlocks = sortedCategories
    .map(([cat, catTweets]) => {
      const slug = cat.replace(/[^a-z0-9]/gi, "-").toLowerCase();
      const tweetCards = catTweets
        .map(
          (tweet) => `
        <div class="tweet-card">
          <div class="tweet-header">
            <a href="https://twitter.com/${escapeHtml(tweet.handle)}" target="_blank" class="author">@${escapeHtml(tweet.handle)}</a>
            <span class="author-name">${escapeHtml(tweet.author)}</span>
          </div>
          <div class="tweet-content">${escapeHtml(tweet.content)}</div>
          <div class="tweet-footer">
            <a href="${escapeHtml(tweet.url)}" target="_blank" class="tweet-link">View on Twitter</a>
            <span class="tweet-date">${tweet.publishedAt}</span>
          </div>
        </div>
      `
        )
        .join("");

      return `
        <section id="${slug}" class="category-section">
          <h2 class="category-header">
            <span class="category-name">${escapeHtml(cat)}</span>
            <span class="category-count">${catTweets.length} tweets</span>
          </h2>
          <div class="tweets-grid">
            ${tweetCards}
          </div>
        </section>
      `;
    })
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Twitter Feed Inspection</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      line-height: 1.5;
      margin: 0;
      padding: 20px;
      background: #f5f5f5;
      color: #333;
    }
    .header {
      max-width: 1200px;
      margin: 0 auto 20px;
      padding: 20px;
      background: white;
      border-radius: 12px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    h1 { margin: 0 0 10px; font-size: 24px; }
    .meta { color: #666; font-size: 14px; }
    .nav {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 15px;
    }
    .nav-link {
      padding: 6px 12px;
      background: #e8f4fd;
      color: #1a73e8;
      text-decoration: none;
      border-radius: 20px;
      font-size: 13px;
      transition: background 0.2s;
    }
    .nav-link:hover { background: #d0e8fc; }
    .category-section {
      max-width: 1200px;
      margin: 0 auto 30px;
    }
    .category-header {
      display: flex;
      align-items: center;
      gap: 15px;
      padding: 15px 20px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      border-radius: 12px 12px 0 0;
      margin: 0;
      font-size: 20px;
      position: sticky;
      top: 0;
      z-index: 10;
    }
    .category-count {
      font-size: 14px;
      font-weight: normal;
      opacity: 0.9;
      background: rgba(255,255,255,0.2);
      padding: 4px 10px;
      border-radius: 20px;
    }
    .tweets-grid {
      display: flex;
      flex-direction: column;
      gap: 1px;
      background: #ddd;
      border-radius: 0 0 12px 12px;
      overflow: hidden;
    }
    .tweet-card {
      background: white;
      padding: 15px 20px;
    }
    .tweet-header {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 8px;
    }
    .author {
      font-weight: 600;
      color: #1da1f2;
      text-decoration: none;
    }
    .author:hover { text-decoration: underline; }
    .author-name { color: #666; font-size: 14px; }
    .tweet-content {
      color: #14171a;
      font-size: 15px;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .tweet-footer {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-top: 10px;
      font-size: 13px;
    }
    .tweet-link {
      color: #1da1f2;
      text-decoration: none;
    }
    .tweet-link:hover { text-decoration: underline; }
    .tweet-date { color: #657786; }

    /* Category-specific colors */
    #ai-ml .category-header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); }
    #geopolitics-economics .category-header { background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%); }
    #progress-studies-science .category-header { background: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%); }
    #personal-growth-relationships .category-header { background: linear-gradient(135deg, #43e97b 0%, #38f9d7 100%); }
    #rationality-ea .category-header { background: linear-gradient(135deg, #fa709a 0%, #fee140 100%); }
    #comedy-entertainment .category-header { background: linear-gradient(135deg, #a18cd1 0%, #fbc2eb 100%); }
    #startups-business .category-header { background: linear-gradient(135deg, #ff9a9e 0%, #fecfef 100%); }
    #sf-bay-area-housing .category-header { background: linear-gradient(135deg, #ffecd2 0%, #fcb69f 100%); color: #333; }
    #writing-culture .category-header { background: linear-gradient(135deg, #a1c4fd 0%, #c2e9fb 100%); color: #333; }
    #engineering-systems .category-header { background: linear-gradient(135deg, #d299c2 0%, #fef9d7 100%); color: #333; }
    #tech-news-strategy .category-header { background: linear-gradient(135deg, #89f7fe 0%, #66a6ff 100%); }
    #other .category-header { background: linear-gradient(135deg, #868f96 0%, #596164 100%); }
  </style>
</head>
<body>
  <div class="header">
    <h1>Twitter Feed Inspection</h1>
    <div class="meta">
      Last updated: ${updatedAt}<br>
      Total tweets: ${tweets.length}
    </div>
    <nav class="nav">
      ${categoryNav}
    </nav>
  </div>

  ${categoryBlocks}

  <script>
    // Smooth scrolling for nav links
    document.querySelectorAll('.nav-link').forEach(link => {
      link.addEventListener('click', e => {
        e.preventDefault();
        const target = document.querySelector(link.getAttribute('href'));
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
  </script>
</body>
</html>`;
}

async function main() {
  const cachePath = "data/classified-tweets.json";
  const outputPath = "data/inspection.html";

  if (!fs.existsSync(cachePath)) {
    console.error("No cached tweets found. Run the classification script first.");
    process.exit(1);
  }

  const cache = JSON.parse(fs.readFileSync(cachePath, "utf8")) as CacheData;
  console.log(`Loaded ${cache.tweets.length} tweets`);

  const html = generateHtml(cache);
  fs.writeFileSync(outputPath, html);
  console.log(`Generated: ${outputPath}`);
  console.log(`Open with: open ${outputPath}`);
}

main().catch(console.error);
