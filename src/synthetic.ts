import { Feed } from "feed";
import * as fs from "fs";
import * as path from "path";

export interface SyntheticItem {
  title: string;
  url: string;
  published: string;
  description: string;
  notes?: string;
}

export interface SyntheticFeed {
  title: string;
  about: string;
  items: SyntheticItem[];
}

export function parseSyntheticFile(filePath: string): SyntheticFeed {
  const content = fs.readFileSync(filePath, "utf8");
  const lines = content.split("\n");

  let title = "";
  let about = "";
  const items: SyntheticItem[] = [];

  let currentItem: Partial<SyntheticItem> | null = null;
  let inAbout = false;
  let inItems = false;
  let currentSection = "";

  for (const line of lines) {
    // Title (h1)
    if (line.startsWith("# ") && !title) {
      title = line.slice(2).trim();
      continue;
    }

    // About section
    if (line.startsWith("## About")) {
      inAbout = true;
      inItems = false;
      currentSection = "about";
      continue;
    }

    // Items section
    if (line.startsWith("## Items")) {
      inAbout = false;
      inItems = true;
      currentSection = "items";
      continue;
    }

    // Other h2 sections end About/Items
    if (line.startsWith("## ")) {
      inAbout = false;
      inItems = false;
      currentSection = "";
      continue;
    }

    // Capture about text
    if (inAbout && line.trim() && !line.startsWith("<!--")) {
      about += line.trim() + " ";
    }

    // Parse items
    if (inItems) {
      // New item (h3)
      if (line.startsWith("### ")) {
        // Save previous item if valid
        if (currentItem?.title && currentItem?.url && currentItem?.published) {
          items.push(currentItem as SyntheticItem);
        }
        currentItem = { title: line.slice(4).trim() };
        continue;
      }

      // Item properties
      if (currentItem && line.startsWith("- ")) {
        const colonIndex = line.indexOf(": ");
        if (colonIndex > 0) {
          const key = line.slice(2, colonIndex).trim();
          const value = line.slice(colonIndex + 2).trim();

          switch (key) {
            case "url":
              currentItem.url = value;
              break;
            case "published":
              currentItem.published = value;
              break;
            case "description":
              currentItem.description = value;
              break;
            case "notes":
              currentItem.notes = value;
              break;
          }
        }
      }
    }
  }

  // Don't forget last item
  if (currentItem?.title && currentItem?.url && currentItem?.published) {
    items.push(currentItem as SyntheticItem);
  }

  return { title, about: about.trim(), items };
}

export function generateSyntheticRSS(
  slug: string,
  syntheticDir: string = "synthetic"
): string {
  const filePath = path.join(process.cwd(), syntheticDir, `${slug}.md`);

  if (!fs.existsSync(filePath)) {
    throw new Error(`Synthetic feed not found: ${slug}`);
  }

  const data = parseSyntheticFile(filePath);
  const now = new Date();

  const feed = new Feed({
    title: data.title,
    description: data.about,
    id: slug,
    link: `https://rss.jasonbenn.com/synthetic/${slug}`,
    copyright: "",
    generator: "jarvis-rss",
    feedLinks: {
      rss: `https://rss.jasonbenn.com/synthetic/${slug}`,
    },
  });

  // Only include items whose published date has passed
  const publishedItems = data.items.filter((item) => {
    const publishDate = new Date(item.published);
    return publishDate <= now;
  });

  // Sort by date descending (newest first)
  publishedItems.sort(
    (a, b) => new Date(b.published).getTime() - new Date(a.published).getTime()
  );

  for (const item of publishedItems) {
    const publishDate = new Date(item.published);
    feed.addItem({
      title: item.title,
      id: item.url,
      link: item.url,
      description: item.description,
      date: publishDate,
    });
  }

  return feed.rss2();
}

export function listSyntheticFeeds(syntheticDir: string = "synthetic"): string[] {
  const dir = path.join(process.cwd(), syntheticDir);
  if (!fs.existsSync(dir)) {
    return [];
  }

  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => f.replace(".md", ""));
}
