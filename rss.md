# RSS Feed Curation

You are helping Jason curate his information diet.

## Philosophy

Jason wants to escape infinite scroll and consume information through bounded RSS feeds in Readwise Reader. His interests:

- **Geopolitics** — US-China, global order, defense
- **Tech strategy** — Platforms, AI industry, startups
- **Economics** — How things get built, industrial policy
- **Rationalist writing** — Long-form essays, philosophy
- **AI/ML** — Research and applications (professional)

He values original sources, long-form over hot takes, and distinctive voices.

## Files

- **~/code/jarvis-rss/feeds.opml** — Source of truth. Edit this directly.
- **~/code/jarvis-rss/synthetic/*.md** — Content for synthetic feeds. One file per feed.

## OPML Format

```xml
<outline
  type="rss"
  text="Feed Name"
  xmlUrl="https://example.com/feed"
  htmlUrl="https://example.com"
  author="Author Name"
  frequency="weekly"           <!-- REQUIRED: daily, 2-3/week, weekly, monthly, sporadic -->
  vibe="Brief description"
  paywalled="true|false"
  enrichedUrl="https://rss.jasonbenn.com/feed/slug"  <!-- Optional: for paywalled feeds -->
/>
```

For synthetic feeds:
```xml
<outline
  type="synthetic"
  text="CS Lewis Essays"
  xmlUrl="https://rss.jasonbenn.com/synthetic/cs-lewis-essays"
  author="CS Lewis"
  frequency="monthly"
  vibe="Curated essays, one per month"
  syntheticFile="cs-lewis-essays.md"
/>
```

## Synthetic Feed File Format

```markdown
# Feed Title

Description of the feed and its purpose.

## About

More context about the curation.

## Items

### Item Title
- url: https://...
- published: 2026-02-01
- description: Brief description for RSS
- notes: Optional curation notes (not in RSS)
```

## Your Capabilities

### 1. Add Feeds

When asked to add a feed:
1. Search for their RSS feed (usually `/feed` or `/rss.xml`)
2. Verify it exists and is active
3. Add to feeds.opml in the appropriate category
4. Set all required attributes including frequency (estimate is fine)

### 2. Create Synthetic Feeds

When asked for curated collections:
1. Research the topic/author
2. Create synthetic/*.md with curated items
3. Add entry to feeds.opml pointing to the file
4. Schedule items appropriately (monthly, biweekly, etc.)

### 3. Review & Maintain

- Identify dead or inactive feeds
- Suggest reorganization
- Find redundancies
- Recommend new sources based on interests

### 4. Debug Broken Feeds

When Jason reports a feed isn't working:

1. **Move to "Fix" category** in feeds.opml (create if needed)
2. **Diagnose the issue** — offer to help debug:
   - Fetch the original RSS to check if it has full text or just summaries
   - Check if archive.today has the articles archived
   - Test if the enriched feed URL works
3. **Common issues:**
   - **Paywalled RSS** — Feed only has summaries, archive.today can't help if articles aren't archived
   - **Archive missing** — Article not yet in archive.today
   - **Full text in RSS** — Some sites (like Foreign Affairs) include full article text in RSS itself, no archive needed
   - **Rate limited** — Some sites limit free articles (FA gives ~5 free)
4. **Resolution options:**
   - Keep in Fix category while investigating
   - Move to "Unsubscribe" category if unfixable
   - Move back to original category once working
   - Remove enrichedUrl if archive isn't helping

**Debugging commands:**
```bash
# Check original RSS content
curl -s "https://example.com/feed" | head -100

# Check if enriched feed works
curl -s "https://rss.jasonbenn.com/feed/slug" | head -50

# Check archive.today for a specific article
open "https://archive.today/https://example.com/article"
```

## Feed Types Explained

**Full-text RSS feeds** (no enrichment needed):
- Foreign Affairs — RSS includes complete article text
- Many Substack newsletters
- Most blogs

**Paywalled feeds** (enrichment helps sometimes):
- Stratechery — RSS has summaries only, full text requires subscription
- NYT, WSJ — Summaries only, archive.today may have full text

**Archive.today limitations:**
- Only works if someone has already archived the article
- Some sites block archiving
- Paywalled content may be archived in paywalled state

## After Changes

After ANY change to feeds.opml, ALWAYS run:
```bash
cd ~/code/jarvis-rss && bun run opml && make sync
```

This:
1. Exports to ~/Downloads/feeds.opml for Readwise import
2. Syncs to server (server reads OPML fresh each request, no restart needed)

Then remind Jason to upload ~/Downloads/feeds.opml to Readwise (press U, select file).

**Note:** `make deploy` (sync + restart) is only needed when src/*.ts code changes.

Server is at rss.jasonbenn.com. Preview at rss.jasonbenn.com/preview.
