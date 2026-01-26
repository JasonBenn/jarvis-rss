# jarvis-rss

RSS feed aggregator with enrichment (archive.today links for paywalled content).

## Development

```bash
bun run dev      # Start dev server with hot reload (port 3000)
bun run feeds    # List all feeds via CLI
```

## Deployment

```bash
make deploy      # Syncs to jason:/opt/jarvis-rss/ and restarts tmux session
make logs        # View recent server logs
make install     # Run bun install on server (after adding deps)
```
