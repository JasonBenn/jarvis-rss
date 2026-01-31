/**
 * Twitter list categorization pipeline.
 *
 * Fetches Twitter list digests from Readwise API, parses tweets,
 * classifies them with Haiku, and generates per-category RSS feeds.
 */

import Anthropic from "@anthropic-ai/sdk";
import { Feed } from "feed";
import * as fs from "fs";
import {
  CATEGORIES,
  categoryToSlug,
  slugToCategory,
} from "./categories";
import type { Category } from "./categories";

const TWITTER_LIST_TITLE_PREFIX = "Following Twitter List:";
const CACHE_PATH = "data/classified-tweets.json";
const MAX_AGE_DAYS = 30;

export interface Tweet {
  id: string;
  author: string;
  handle: string;
  content: string;
  url: string;
  publishedAt: string;
  category?: Category;
}

interface CacheData {
  updatedAt: string;
  tweets: Tweet[];
}

export interface ReadwiseDocument {
  id: string;
  title?: string;
  source?: string;
  html_content?: string;
  category?: string;
  published_date?: string;
}

interface ReadwiseResponse {
  results?: ReadwiseDocument[];
  nextPageCursor?: string;
}

/**
 * Parse tweets from a Readwise digest document.
 */
export function parseTweetsFromDocument(
  doc: ReadwiseDocument
): Omit<Tweet, "category">[] {
  const html = doc.html_content ?? "";
  const digestDate = doc.published_date ?? new Date().toISOString();
  const tweets: Omit<Tweet, "category">[] = [];

  // Match embedded tweet articles
  const tweetRegex =
    /<article[^>]*class="[^"]*rw-embedded-tweet[^"]*"[^>]*>([\s\S]*?)<\/article>/gi;
  let match;

  while ((match = tweetRegex.exec(html)) !== null) {
    const articleHtml = match[1] || "";

    // Extract author name from profile link
    const authorMatch = articleHtml.match(
      /<a[^>]*href="https:\/\/twitter\.com\/[^"]*"[^>]*>([^<]+)<\/a>/i
    );
    const author = authorMatch?.[1]?.trim() ?? "Unknown";

    // Extract handle from URL
    const handleMatch = articleHtml.match(
      /href="https:\/\/twitter\.com\/([^/"\s]+)/i
    );
    const handle = handleMatch?.[1] ?? "unknown";

    // Extract tweet URL (twitter.com or x.com)
    const urlMatch = articleHtml.match(
      /href="(https:\/\/(?:twitter|x)\.com\/[^"]+\/status\/\d+)"/i
    );
    const url = urlMatch?.[1] ?? "";

    // Extract tweet ID from URL
    const idMatch = url.match(/status\/(\d+)/);
    const id = idMatch?.[1] ?? `${handle}-${Date.now()}`;

    // Extract tweet content - look for the main text paragraph
    let content = "";

    // Try to find content in various ways
    const contentPatterns = [
      // Pattern 1: <p> tag with tweet text
      /<p[^>]*class="[^"]*tweet-text[^"]*"[^>]*>([\s\S]*?)<\/p>/i,
      // Pattern 2: div with tweet content
      /<div[^>]*class="[^"]*tweet-content[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
      // Pattern 3: Just get all text content after author section
      /<\/a>\s*<\/div>([\s\S]*?)<\/article>/i,
    ];

    for (const pattern of contentPatterns) {
      const contentMatch = articleHtml.match(pattern);
      if (contentMatch?.[1]) {
        content = contentMatch[1]
          .replace(/<[^>]+>/g, " ") // Strip HTML tags
          .replace(/\s+/g, " ") // Normalize whitespace
          .trim();
        if (content.length > 10) break;
      }
    }

    // Fallback: extract all visible text
    if (!content || content.length < 10) {
      content = articleHtml
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    }

    if (content && url) {
      tweets.push({
        id,
        author,
        handle,
        content: content.slice(0, 500), // Truncate long tweets
        url,
        publishedAt: digestDate,
      });
    }
  }

  return tweets;
}

/**
 * Fetch Twitter list digests from Readwise API.
 * Returns documents from the "Following" Twitter List feed.
 */
export async function fetchReadwiseDigests(): Promise<ReadwiseDocument[]> {
  const token = process.env.READWISE_TOKEN;
  if (!token) {
    throw new Error("READWISE_TOKEN environment variable not set");
  }

  // Fetch feed items with HTML content
  const params = new URLSearchParams({
    category: "rss",
    location: "feed",
    withHtmlContent: "true",
  });

  const response = await fetch(
    `https://readwise.io/api/v3/list/?${params}`,
    {
      headers: {
        Authorization: `Token ${token}`,
      },
    }
  );

  if (!response.ok) {
    throw new Error(`Readwise API error: ${response.status}`);
  }

  const data = (await response.json()) as ReadwiseResponse;

  // Filter for Twitter list feed by title pattern
  const digests = (data.results ?? []).filter(
    (item) => item.title?.startsWith(TWITTER_LIST_TITLE_PREFIX) && item.html_content
  );

  return digests;
}

/**
 * Classify a batch of tweets using Haiku.
 */
export async function classifyTweets(
  tweets: Omit<Tweet, "category">[]
): Promise<Tweet[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY environment variable not set");
  }

  const client = new Anthropic({ apiKey });
  const classified: Tweet[] = [];
  const categoryList = CATEGORIES.join(", ");

  // Process in batches of 10 for efficiency
  const BATCH_SIZE = 10;

  for (let i = 0; i < tweets.length; i += BATCH_SIZE) {
    const batch = tweets.slice(i, i + BATCH_SIZE);

    // Build a single prompt for the batch
    const tweetDescriptions = batch
      .map((t, idx) => `${idx + 1}. @${t.handle}: ${t.content.slice(0, 200)}`)
      .join("\n\n");

    const prompt = `Classify each tweet into exactly one category:
- AI/ML: Artificial intelligence, machine learning, LLMs, AI safety, AI products/companies
- Funny: Jokes, comedy, humor, satire (but if it's funny AND about AI, use AI/ML)
- Other: Everything else

Tweets:
${tweetDescriptions}

Respond with ONLY the category name on each line, one per tweet, in order.`;

    try {
      const message = await client.messages.create({
        model: "claude-3-5-haiku-latest",
        max_tokens: 256,
        messages: [{ role: "user", content: prompt }],
      });

      const firstContent = message.content[0];
      const responseText =
        firstContent && firstContent.type === "text" ? firstContent.text : "";
      const categories = responseText
        .split("\n")
        .map((line: string) => line.trim())
        .filter((line: string) => line.length > 0);

      for (let j = 0; j < batch.length; j++) {
        const batchItem = batch[j];
        if (!batchItem) continue;

        const categoryName = categories[j] || "Other";
        // Validate the category
        const validCategory = CATEGORIES.includes(categoryName as Category)
          ? (categoryName as Category)
          : "Other";

        classified.push({
          id: batchItem.id,
          author: batchItem.author,
          handle: batchItem.handle,
          content: batchItem.content,
          url: batchItem.url,
          publishedAt: batchItem.publishedAt,
          category: validCategory,
        });
      }
    } catch (error) {
      console.error(`Error classifying batch ${i / BATCH_SIZE + 1}:`, error);
      // On error, default to "Other"
      for (const tweet of batch) {
        classified.push({
          id: tweet.id,
          author: tweet.author,
          handle: tweet.handle,
          content: tweet.content,
          url: tweet.url,
          publishedAt: tweet.publishedAt,
          category: "Other",
        });
      }
    }
  }

  return classified;
}

/**
 * Load cached tweets from disk.
 */
export function loadCache(): CacheData | null {
  try {
    if (fs.existsSync(CACHE_PATH)) {
      const data = JSON.parse(fs.readFileSync(CACHE_PATH, "utf8")) as CacheData;
      return data;
    }
  } catch (error) {
    console.error("Error loading cache:", error);
  }
  return null;
}

/**
 * Save classified tweets to cache.
 */
export function saveCache(tweets: Tweet[]): void {
  // Filter to last 30 days
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - MAX_AGE_DAYS);

  const recentTweets = tweets.filter(
    (t) => new Date(t.publishedAt) >= cutoff
  );

  const data: CacheData = {
    updatedAt: new Date().toISOString(),
    tweets: recentTweets,
  };

  fs.writeFileSync(CACHE_PATH, JSON.stringify(data, null, 2));
}

/**
 * Merge new tweets with cached tweets, deduplicating by ID.
 */
export function mergeTweets(existing: Tweet[], newTweets: Tweet[]): Tweet[] {
  const byId = new Map<string, Tweet>();

  for (const tweet of existing) {
    byId.set(tweet.id, tweet);
  }

  for (const tweet of newTweets) {
    if (!byId.has(tweet.id)) {
      byId.set(tweet.id, tweet);
    }
  }

  return Array.from(byId.values()).sort(
    (a, b) =>
      new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
  );
}

/**
 * Generate RSS feed for a specific category.
 */
export function generateCategoryRss(
  tweets: Tweet[],
  category: Category
): string {
  const categoryTweets = tweets.filter((t) => t.category === category);
  const slug = categoryToSlug(category);

  const feed = new Feed({
    title: `Twitter: ${category}`,
    description: `Categorized tweets from Twitter Following list - ${category}`,
    id: `https://rss.jasonbenn.com/twitter/${slug}`,
    link: `https://rss.jasonbenn.com/twitter/${slug}`,
    language: "en",
    updated: new Date(),
    copyright: "",
  });

  for (const tweet of categoryTweets.slice(0, 50)) {
    feed.addItem({
      title: `@${tweet.handle}: ${tweet.content.slice(0, 100)}${tweet.content.length > 100 ? "..." : ""}`,
      id: tweet.id,
      link: tweet.url,
      description: tweet.content,
      author: [{ name: tweet.author, link: `https://twitter.com/${tweet.handle}` }],
      date: new Date(tweet.publishedAt),
    });
  }

  return feed.rss2();
}

/**
 * Generate RSS feed with all tweets, tagged with categories.
 */
export function generateAllTweetsRss(tweets: Tweet[]): string {
  const feed = new Feed({
    title: "Twitter: All Categories",
    description: "All categorized tweets from Twitter Following list",
    id: "https://rss.jasonbenn.com/twitter/all",
    link: "https://rss.jasonbenn.com/twitter/all",
    language: "en",
    updated: new Date(),
    copyright: "",
  });

  for (const tweet of tweets.slice(0, 100)) {
    feed.addItem({
      title: `[${tweet.category}] @${tweet.handle}: ${tweet.content.slice(0, 80)}${tweet.content.length > 80 ? "..." : ""}`,
      id: tweet.id,
      link: tweet.url,
      description: `<p><strong>Category:</strong> ${tweet.category}</p><p>${tweet.content}</p>`,
      author: [{ name: tweet.author, link: `https://twitter.com/${tweet.handle}` }],
      date: new Date(tweet.publishedAt),
    });
  }

  return feed.rss2();
}

/**
 * Get category stats from cached tweets.
 */
export function getCategoryStats(
  tweets: Tweet[]
): { category: Category; slug: string; count: number }[] {
  const counts = new Map<Category, number>();

  for (const cat of CATEGORIES) {
    counts.set(cat, 0);
  }

  for (const tweet of tweets) {
    if (tweet.category) {
      counts.set(tweet.category, (counts.get(tweet.category) || 0) + 1);
    }
  }

  return Array.from(counts.entries())
    .filter(([_, count]) => count > 0)
    .map(([category, count]) => ({
      category,
      slug: categoryToSlug(category),
      count,
    }))
    .sort((a, b) => b.count - a.count);
}

export { slugToCategory };
