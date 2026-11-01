# Deploy via git (push locally, pull on server)
deploy:
	git push && ssh nose 'cd /opt/jarvis-rss && git pull && sudo systemctl restart jarvis-rss'

# Just restart the service (no code changes)
restart:
	ssh nose 'sudo systemctl restart jarvis-rss'

# Pull latest and install dependencies
install:
	ssh nose 'cd /opt/jarvis-rss && git pull && bun install'

# View recent logs
logs:
	ssh nose 'journalctl -u jarvis-rss -n 50 --no-pager'

# Check service health
health:
	ssh nose 'curl -s localhost:3001/health'

# SSH to server
ssh:
	ssh nose

# Refresh data/eval-set.jsonl from Reader (reads only) and print counts
eval-set:
	set -a; . ~/.claude/skills/readwise/.env; set +a; bun run src/eval-set.ts --summary

# Judge the eval set with a prompt from src/eval-prompts.ts (P=baseline), then report it
eval:
	bun run src/eval.ts --prompt $(or $(P),baseline) && bun run src/eval.ts --report $(or $(P),baseline)

.PHONY: deploy restart install logs health ssh eval-set eval
