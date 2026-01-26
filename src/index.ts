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

// Archive redirect - handles Readwise's ?__readwiseLocation= query param
app.get("/archive", (c) => {
  const url = c.req.query("url");
  if (!url) {
    return c.json({ error: "Missing url parameter" }, 400);
  }
  return c.redirect(`https://archive.today/${url}`, 302);
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

    const sourceUrl = feed.sourceUrl || feed.xmlUrl;
    if (!sourceUrl) {
      return c.json({ error: "Feed has no source URL" }, 400);
    }

    const rss = await enrichFeedCached(sourceUrl, feed.htmlUrl);
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

// RSS Feed Preview - renders feed as HTML for testing
app.get("/preview", async (c) => {
  const feedUrl = c.req.query("url");
  const slug = c.req.query("slug");

  // Get list of available feeds for the dropdown, grouped by category
  const { feeds, categories } = parseOPML("feeds.opml");
  const feedOptions = categories
    .map((category) => {
      const categoryFeeds = feeds.filter((f) => f.category === category);
      if (categoryFeeds.length === 0) return "";
      const options = categoryFeeds
        .map((f) => {
          const feedSlug = slugify(f.text);
          return `<option value="${feedSlug}" ${feedSlug === slug ? "selected" : ""}>${f.text}</option>`;
        })
        .join("\n");
      return `<optgroup label="${category}">${options}</optgroup>`;
    })
    .join("\n");

  let feedContent = "";
  let rawFeedXml = "";

  if (slug || feedUrl) {
    try {
      let rssText = "";

      if (slug) {
        // Try enriched feed first, then synthetic
        const feed = findFeedBySlug(feeds, slug);
        if (feed) {
          if (feed.type === "synthetic") {
            rssText = generateSyntheticRSS(
              feed.syntheticFile?.replace(".md", "") || slug
            );
          } else if (feed.sourceUrl || feed.xmlUrl) {
            const sourceUrl = feed.sourceUrl || feed.xmlUrl;
            rssText = await enrichFeedCached(sourceUrl, feed.htmlUrl);
          }
        } else {
          // Try as synthetic feed directly
          try {
            rssText = generateSyntheticRSS(slug);
          } catch {
            feedContent = `<p class="error">Feed not found: ${slug}</p>`;
          }
        }
      } else if (feedUrl) {
        const response = await fetch(feedUrl);
        rssText = await response.text();
      }

      if (rssText) {
        rawFeedXml = rssText;
        // Parse RSS and render as HTML
        const { XMLParser } = await import("fast-xml-parser");
        const parser = new XMLParser({
          ignoreAttributes: false,
          attributeNamePrefix: "@_",
        });
        const parsed = parser.parse(rssText);

        let items: any[] = [];
        let feedTitle = "";

        if (parsed.rss?.channel) {
          feedTitle = parsed.rss.channel.title || "";
          items = parsed.rss.channel.item || [];
          if (!Array.isArray(items)) items = [items];
        } else if (parsed.feed?.entry) {
          feedTitle = parsed.feed.title || "";
          items = parsed.feed.entry || [];
          if (!Array.isArray(items)) items = [items];
        }

        feedContent = `
          <h2>${feedTitle}</h2>
          <p class="meta">${items.length} items</p>
          ${items
            .slice(0, 20)
            .map((item) => {
              const title = item.title || "Untitled";
              let link = item.link || "";
              if (typeof link === "object") {
                link = link["@_href"] || link["#text"] || "";
              }
              let description = item.description || item.summary || "";
              if (typeof description === "object") {
                description = description["#text"] || description.__cdata || "";
              }
              const pubDate = item.pubDate || item.published || "";

              return `
                <article>
                  <h3><a href="${link}" target="_blank">${title}</a></h3>
                  <p class="meta">${pubDate}</p>
                  <p class="link">Link: <a href="${link}" target="_blank">${link}</a></p>
                  <div class="description">${description}</div>
                </article>
              `;
            })
            .join("")}
        `;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      feedContent = `<p class="error">Error: ${message}</p>`;
    }
  }

  const html = `<!DOCTYPE html>
<html>
<head>
  <title>RSS Feed Preview</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
    .controls { background: #f5f5f5; padding: 15px; border-radius: 8px; margin-bottom: 20px; }
    .controls form { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
    select, button { padding: 8px 12px; font-size: 14px; }
    select { min-width: 200px; }
    button { background: #FF6B35; color: white; border: none; border-radius: 4px; cursor: pointer; }
    button:hover { background: #e55a2b; }
    article { border-bottom: 1px solid #eee; padding: 15px 0; }
    article h3 { margin: 0 0 5px 0; }
    article h3 a { color: #333; text-decoration: none; }
    article h3 a:hover { color: #FF6B35; }
    .meta { color: #666; font-size: 13px; margin: 5px 0; }
    .link { font-size: 12px; color: #888; word-break: break-all; }
    .link a { color: #0066cc; }
    .description { margin-top: 10px; font-size: 14px; line-height: 1.5; }
    .description p { margin: 5px 0; }
    .error { color: #c00; background: #fee; padding: 10px; border-radius: 4px; }
    h2 { margin-top: 0; }
  </style>
</head>
<body>
  <h1>RSS Feed Preview</h1>
  <div class="controls">
    <form method="get">
      <select name="slug" onchange="this.form.submit()">
        <option value="">-- Select a feed --</option>
        ${feedOptions}
      </select>
      ${slug ? `<button type="button" onclick="copyFeedUrl()">Copy Feed URL</button>` : ""}
      ${rawFeedXml ? `<button type="button" onclick="toggleRaw()">View Raw</button>` : ""}
    </form>
  </div>
  <div id="feed-content">
    ${feedContent || "<p>Select a feed to preview.</p>"}
  </div>
  ${slug ? `
  <script>
    function copyFeedUrl() {
      const url = window.location.origin + '/feed/${slug}';
      navigator.clipboard.writeText(url).then(() => {
        const btn = document.querySelector('button[onclick="copyFeedUrl()"]');
        btn.textContent = 'Copied!';
        setTimeout(() => btn.textContent = 'Copy Feed URL', 2000);
      });
    }
  </script>
  ` : ""}
  ${rawFeedXml ? `
  <pre id="raw-feed" style="display: none; background: #f5f5f5; padding: 15px; border-radius: 8px; overflow-x: auto; font-size: 12px; white-space: pre-wrap; word-break: break-word;">${rawFeedXml.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre>
  <script>
    function toggleRaw() {
      const feedContent = document.getElementById('feed-content');
      const rawFeed = document.getElementById('raw-feed');
      const btn = document.querySelector('button[onclick="toggleRaw()"]');
      if (rawFeed.style.display === 'none') {
        rawFeed.style.display = 'block';
        feedContent.style.display = 'none';
        btn.textContent = 'View Parsed';
      } else {
        rawFeed.style.display = 'none';
        feedContent.style.display = 'block';
        btn.textContent = 'View Raw';
      }
    }
  </script>
  ` : ""}
</body>
</html>`;

  return c.html(html);
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
