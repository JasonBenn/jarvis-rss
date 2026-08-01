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
