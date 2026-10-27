# jarvis-rss

RSS feed aggregator with enrichment (archive.today links for paywalled content).

## Development

```bash
bun run dev      # Start dev server with hot reload (port 3000)
bun run feeds    # List all feeds via CLI
```

## Deployment

```bash
make deploy      # git push, then pull + systemctl restart jarvis-rss on nose
make logs        # View recent server logs (journalctl)
make install     # Run bun install on server (after adding deps)
```

On nose the server runs as systemd unit `jarvis-rss.service` (port 3001, behind nginx at rss.jasonbenn.com).

## Feed filter

`src/filter.ts` runs every 30 minutes from cron on nose (`~/.claude/nose/crontab`, log in `~/.local/state/feed-filter.log`). It judges documents that arrived in Reader's `feed` location since the watermark in `data/filter-state.json` against `taste.md` plus Jason's 40 latest hand saves, using `claude-sonnet-5-5`. Every arrival except YouTube Shorts is scored; the highest scores >= `KEEP_THRESHOLD` get tag `pick` and a one-line why as their summary until 20 have been kept that Pacific day (`DAILY_BUDGET`, counted in `data/filter-state.json`); the rest, including over-budget items and lower-scored duplicates of the same post from another feed (same normalized url or title), are deleted from Reader. Opened, tagged, noted or progressed documents, and anything outside `feed`, are never touched (guards and tests in `src/filter.test.ts`). Every judgment is appended to `data/filter-ledger.jsonl` before any write, and that ledger is the only way back: to re-save a deleted item, `jq -r 'select(.action=="delete" and (.title|test("<words>";"i"))) | .url' data/filter-ledger.jsonl` and POST each url to `https://readwise.io/api/v3/save/` with `{"url": "<url>"}` and `Authorization: Token $READWISE_TOKEN`. Try it with `bun run src/filter.ts --dry-run --since <iso>` (writes ledger rows with action `dry-run`, touches nothing in Reader). `src/sweep.ts [--dry-run]` is the one-off backlog sweep: it classifies every feed (by YouTube channel or source host) as timeless, topical or low into `data/feed-classes.json`, then deletes never-touched feed documents from topical and low feeds, ledgered as `sweep-delete` (a 404 adds a `sweep-gone` row; any other failed DELETE aborts). Keys that lump several feeds (`email:*`, `archive.today`) are never swept, and only `--dry-run` classifies new feeds: the real run refuses to start if any is unclassified. Launch long runs with `setsid nohup bun run src/sweep.ts >> ~/.local/state/feed-sweep.log 2>&1 < /dev/null &` so they outlive the launching session; plain `nohup` died with its shell partway through the first sweep.
