#!/usr/bin/env bun
/**
 * Extract YouTube subscriptions and generate RSS feed URLs.
 *
 * Uses Playwright to:
 * 1. Load your subscriptions from /feed/channels (may need login)
 * 2. Extract channel IDs from each channel page
 * 3. Generate RSS URLs using UULF format (long-form videos only, no Shorts)
 *
 * Usage: bun scripts/extract-youtube-subs.ts
 */

import { chromium, type Page } from "playwright";
import { join } from "path";
import { existsSync, mkdirSync } from "fs";

// Persistent browser data directory - login state saved here
const BROWSER_DATA_DIR = join(import.meta.dir, ".browser-data");

interface ChannelInfo {
  name: string;
  handle: string;
  channelId: string;
  rssUrl: string;
  htmlUrl: string;
}

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForLogin(page: Page) {
  // Check if we're logged in by looking for the avatar or sign-in button
  const maxWait = 300000; // 5 minutes to log in
  const startTime = Date.now();
  let promptedLogin = false;

  while (Date.now() - startTime < maxWait) {
    try {
      // Check current URL
      const url = page.url();

      // If we're still on login/accounts pages, wait
      if (url.includes("accounts.google.com")) {
        if (!promptedLogin) {
          console.log("\nLogging in... please complete the Google sign-in process.\n");
          promptedLogin = true;
        }
        await sleep(2000);
        continue;
      }

      // Navigate back to subscriptions if we ended up elsewhere after login
      if (!url.includes("youtube.com/feed/channels")) {
        await page.goto("https://www.youtube.com/feed/channels", {
          waitUntil: "networkidle",
          timeout: 30000
        });
        await sleep(2000);
      }

      // Check if we're on the subscriptions page with content
      const hasChannels = await page.evaluate(() => {
        return document.querySelectorAll('a#main-link[href*="/@"]').length > 0;
      });

      if (hasChannels) {
        return true;
      }

      // Check if there's a sign-in button (meaning not logged in)
      const hasSignIn = await page.evaluate(() => {
        return document.querySelector('a[href*="accounts.google.com"]') !== null ||
               document.querySelector('ytd-button-renderer a[aria-label*="Sign in"]') !== null ||
               document.body.textContent?.includes("Sign in");
      });

      if (hasSignIn && !promptedLogin) {
        console.log("\nYou need to log into YouTube. Please sign in via the browser window...");
        console.log("Waiting for login (5 minute timeout)...\n");
        promptedLogin = true;
      }

      await sleep(2000);
    } catch (error) {
      // Page might be navigating, just wait and retry
      await sleep(1000);
    }
  }

  return false;
}

async function scrollToLoadAll(page: Page) {
  console.log("Scrolling to load all subscriptions...");

  let previousHeight = 0;
  let sameHeightCount = 0;

  while (sameHeightCount < 3) {
    const currentHeight = await page.evaluate(() => document.documentElement.scrollHeight);

    if (currentHeight === previousHeight) {
      sameHeightCount++;
    } else {
      sameHeightCount = 0;
    }

    previousHeight = currentHeight;

    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await sleep(1000);
  }

  // Scroll back to top
  await page.evaluate(() => window.scrollTo(0, 0));
  console.log("Finished scrolling.");
}

async function extractChannelLinks(page: Page): Promise<Array<{ name: string; url: string }>> {
  // Debug: log what we can see on the page
  const debugInfo = await page.evaluate(() => {
    const allLinks = document.querySelectorAll('a[href*="/@"]');
    const mainLinks = document.querySelectorAll('a#main-link');
    const channelLinks = document.querySelectorAll('a#main-link[href*="/@"]');
    const ytdItems = document.querySelectorAll('ytd-channel-renderer');
    const subscriptionItems = document.querySelectorAll('ytd-subscription-notification-renderer');

    return {
      url: window.location.href,
      allLinksWithAt: allLinks.length,
      mainLinks: mainLinks.length,
      channelLinksWithMainLink: channelLinks.length,
      ytdChannelRenderers: ytdItems.length,
      subscriptionNotificationRenderers: subscriptionItems.length,
      sampleLinks: Array.from(allLinks).slice(0, 5).map(l => ({
        href: (l as HTMLAnchorElement).href,
        id: l.id,
        className: l.className
      }))
    };
  });

  console.log("Debug info:", JSON.stringify(debugInfo, null, 2));

  return page.evaluate(() => {
    const channels: Array<{ name: string; url: string }> = [];

    // Try multiple selectors
    // Method 1: ytd-channel-renderer (main subscription list)
    const channelRenderers = document.querySelectorAll('ytd-channel-renderer');
    channelRenderers.forEach((renderer) => {
      const link = renderer.querySelector('a#main-link') as HTMLAnchorElement;
      const nameEl = renderer.querySelector('#channel-name #text, #text-container #text, yt-formatted-string#text');
      const name = nameEl?.textContent?.trim() || "";
      const href = link?.href;

      if (href && name && !channels.some((c) => c.url === href)) {
        channels.push({ name, url: href });
      }
    });

    // Method 2: Direct link query if method 1 fails
    if (channels.length === 0) {
      const links = document.querySelectorAll('a[href*="/@"]');
      links.forEach((link) => {
        const href = (link as HTMLAnchorElement).href;
        if (href.includes("youtube.com/@") && !href.includes("/videos") && !href.includes("/shorts")) {
          // Try to find a name nearby
          const parent = link.closest('ytd-channel-renderer, ytd-grid-channel-renderer, div[class*="channel"]');
          const nameEl = parent?.querySelector('#channel-name, #text, yt-formatted-string') ||
                        link.querySelector('#text, yt-formatted-string');
          let name = nameEl?.textContent?.trim() || "";

          // Fallback: extract from URL
          if (!name) {
            const match = href.match(/@([^/]+)/);
            name = match ? match[1] : "";
          }

          if (href && name && !channels.some((c) => c.url === href)) {
            channels.push({ name, url: href });
          }
        }
      });
    }

    return channels;
  });
}

async function getChannelId(page: Page, channelUrl: string, retries = 3): Promise<string | null> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      // Wait a bit between navigations to avoid conflicts
      await sleep(300);

      await page.goto(channelUrl, { waitUntil: "networkidle", timeout: 20000 });
      await sleep(500);

      // Try to get channel ID from the page's canonical URL or meta tags
      const channelId = await page.evaluate(() => {
        // Method 1: Look for channel ID in meta tags
        const ogUrl = document.querySelector('meta[property="og:url"]')?.getAttribute("content");
        if (ogUrl) {
          const match = ogUrl.match(/channel\/(UC[a-zA-Z0-9_-]+)/);
          if (match) return match[1];
        }

        // Method 2: Look in the page source for channelId
        const scripts = document.querySelectorAll("script");
        for (const script of scripts) {
          const text = script.textContent || "";
          const match = text.match(/"channelId":"(UC[a-zA-Z0-9_-]+)"/);
          if (match) return match[1];
        }

        // Method 3: Check canonical link
        const canonical = document.querySelector('link[rel="canonical"]')?.getAttribute("href");
        if (canonical) {
          const match = canonical.match(/channel\/(UC[a-zA-Z0-9_-]+)/);
          if (match) return match[1];
        }

        return null;
      });

      if (channelId) {
        return channelId;
      }

      // If no channel ID found but no error, don't retry
      return null;
    } catch (error) {
      if (attempt < retries) {
        console.log(`  Retry ${attempt}/${retries} for ${channelUrl}`);
        await sleep(1000);
      } else {
        console.error(`  Failed after ${retries} attempts: ${(error as Error).message?.split('\n')[0]}`);
        return null;
      }
    }
  }
  return null;
}

function generateRssUrl(channelId: string): string {
  // Use UULF prefix instead of UU to get only long-form videos (no Shorts)
  // Channel IDs start with UC, we replace UC with UULF
  const playlistId = "UULF" + channelId.slice(2);
  return `https://www.youtube.com/feeds/videos.xml?playlist_id=${playlistId}`;
}

function generateOpmlEntry(channel: ChannelInfo): string {
  const escapedName = channel.name.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  return `      <outline
        type="rss"
        text="${escapedName}"
        xmlUrl="${channel.rssUrl}"
        htmlUrl="${channel.htmlUrl}"
      />`;
}

async function main() {
  // Create persistent browser data directory
  if (!existsSync(BROWSER_DATA_DIR)) {
    mkdirSync(BROWSER_DATA_DIR, { recursive: true });
  }

  console.log("Launching browser with persistent session...");
  console.log(`Session data: ${BROWSER_DATA_DIR}`);
  console.log("(You only need to log in once - session is saved)\n");

  // Use persistent context - login state is preserved between runs
  const context = await chromium.launchPersistentContext(BROWSER_DATA_DIR, {
    headless: false,
    channel: "chrome",
    viewport: { width: 1280, height: 800 },
    args: [
      "--disable-blink-features=AutomationControlled",
    ],
  });

  const page = context.pages()[0] || await context.newPage();

  try {
    console.log("Navigating to YouTube subscriptions...");
    await page.goto("https://www.youtube.com/feed/channels", {
      waitUntil: "networkidle",
      timeout: 30000
    });

    // Wait for content to load or for user to log in
    await sleep(2000);

    const loggedIn = await waitForLogin(page);
    if (!loggedIn) {
      console.error("Timed out waiting for login. Please run again and log in more quickly.");
      await browser.close();
      process.exit(1);
    }

    // Scroll to load all subscriptions
    await scrollToLoadAll(page);

    // Extract channel links
    const channelLinks = await extractChannelLinks(page);
    console.log(`Found ${channelLinks.length} subscribed channels.`);

    if (channelLinks.length === 0) {
      console.error("No channels found. You may need to log in to YouTube.");
      await browser.close();
      process.exit(1);
    }

    // Get channel IDs for each channel
    const channels: ChannelInfo[] = [];

    for (let i = 0; i < channelLinks.length; i++) {
      const { name, url } = channelLinks[i];
      console.log(`[${i + 1}/${channelLinks.length}] Processing: ${name}`);

      const channelId = await getChannelId(page, url);

      if (channelId) {
        const handle = url.split("/").pop() || "";
        channels.push({
          name,
          handle,
          channelId,
          rssUrl: generateRssUrl(channelId),
          htmlUrl: url,
        });
        console.log(`  Channel ID: ${channelId}`);
      } else {
        console.log(`  Skipped (no channel ID found)`);
      }
    }

    console.log(`\nSuccessfully extracted ${channels.length} channels.`);

    // Generate OPML entries
    console.log("\n--- OPML Entries ---\n");
    const opmlCategory = `    <outline text="YouTube" title="YouTube">
${channels.map(generateOpmlEntry).join("\n\n")}
    </outline>`;

    console.log(opmlCategory);

    // Also save JSON for reference
    const outputPath = join(import.meta.dir, "youtube-channels.json");
    await Bun.write(outputPath, JSON.stringify(channels, null, 2));
    console.log(`\nJSON data saved to: ${outputPath}`);

    // Save OPML snippet
    const opmlPath = join(import.meta.dir, "youtube-opml-snippet.xml");
    await Bun.write(opmlPath, opmlCategory);
    console.log(`OPML snippet saved to: ${opmlPath}`);

  } finally {
    await context.close();
  }
}

main().catch(console.error);
