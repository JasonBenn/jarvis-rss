import { Hono } from "hono";
import { cors } from "hono/cors";
import { parseOPML, slugify, findFeedBySlug, feedsToTable } from "./opml";
import { generateSyntheticRSS, listSyntheticFeeds } from "./synthetic";
import { enrichFeedCached } from "./enricher";

const app = new Hono();

app.use("*", cors());

// Health check
app.get("/health", (c) => {
  return c.json({ status: "ok", timestamp: new Date().toISOString() });
});

// List all feeds from OPML
app.get("/feeds", (c) => {
  try {
    const { feeds, categories, head } = parseOPML("feeds.opml");
    return c.json({
      title: head.title,
      owner: head.ownerName,
      lastModified: head.dateModified,
      categories,
      feedCount: feeds.length,
      feeds: feeds.map((f) => ({
        name: f.text,
        slug: slugify(f.text),
        type: f.type,
        category: f.category,
        author: f.author,
        frequency: f.frequency,
        vibe: f.vibe,
        paywalled: f.paywalled === "true",
        xmlUrl: f.xmlUrl,
        enrichedUrl: f.enrichedUrl,
      })),
    });
  } catch (error) {
    return c.json({ error: "Failed to parse OPML" }, 500);
  }
});

// List all feeds as plain text table
app.get("/feeds/table", (c) => {
  try {
    const { feeds } = parseOPML("feeds.opml");
    const table = feedsToTable(feeds);
    return c.text(table);
  } catch (error) {
    return c.json({ error: "Failed to parse OPML" }, 500);
  }
});

// Enriched feed (adds archive.today links for paywalled content)
app.get("/feed/:slug", async (c) => {
  const slug = c.req.param("slug");

  try {
    const { feeds } = parseOPML("feeds.opml");
    const feed = findFeedBySlug(feeds, slug);

    if (!feed) {
      return c.json(
        {
          error: "Feed not found",
          available: feeds.map((f) => ({
            name: f.text,
            slug: slugify(f.text),
          })),
        },
        404
      );
    }

    if (!feed.xmlUrl) {
      return c.json({ error: "Feed has no source URL" }, 400);
    }

    const rss = await enrichFeedCached(feed.xmlUrl);
    return c.body(rss, 200, { "Content-Type": "application/rss+xml" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return c.json({ error: `Failed to enrich feed: ${message}` }, 500);
  }
});

// Synthetic feed
app.get("/synthetic/:slug", (c) => {
  const slug = c.req.param("slug");

  try {
    const rss = generateSyntheticRSS(slug);
    return c.body(rss, 200, { "Content-Type": "application/rss+xml" });
  } catch (error) {
    const available = listSyntheticFeeds();
    return c.json(
      {
        error: "Synthetic feed not found",
        requestedSlug: slug,
        available,
      },
      404
    );
  }
});

// List available synthetic feeds
app.get("/synthetic", (c) => {
  const available = listSyntheticFeeds();
  return c.json({
    count: available.length,
    feeds: available.map((slug) => ({
      slug,
      url: `https://rss.jasonbenn.com/synthetic/${slug}`,
    })),
  });
});

// Serve the OPML file directly
app.get("/feeds.opml", async (c) => {
  try {
    const file = Bun.file("feeds.opml");
    const content = await file.text();
    return c.body(content, 200, { "Content-Type": "application/xml" });
  } catch (error) {
    return c.json({ error: "OPML file not found" }, 404);
  }
});

// Serve feed icon (simple RSS icon SVG)
app.get("/icon.png", (c) => {
  // Redirect to a simple RSS icon - using a data URI SVG converted to show as image
  // For a proper icon, you'd serve an actual PNG file
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">
    <rect width="100" height="100" rx="20" fill="#FF6B35"/>
    <circle cx="25" cy="75" r="10" fill="white"/>
    <path d="M25 45 a30 30 0 0 1 30 30" stroke="white" stroke-width="10" fill="none" stroke-linecap="round"/>
    <path d="M25 20 a55 55 0 0 1 55 55" stroke="white" stroke-width="10" fill="none" stroke-linecap="round"/>
  </svg>`;
  return c.body(svg, 200, { "Content-Type": "image/svg+xml" });
});

// Root - show API info
app.get("/", (c) => {
  return c.json({
    name: "jarvis-rss",
    description: "Claude-powered RSS feed curation",
    endpoints: {
      "/health": "Health check",
      "/feeds": "List all feeds (JSON)",
      "/feeds/table": "List all feeds (plain text table)",
      "/feeds.opml": "Download OPML file",
      "/feed/:slug": "Get enriched RSS feed (with archive links)",
      "/synthetic": "List synthetic feeds",
      "/synthetic/:slug": "Get synthetic RSS feed",
    },
    source: "https://github.com/jasonbenn/jarvis-rss",
  });
});

export default app;
