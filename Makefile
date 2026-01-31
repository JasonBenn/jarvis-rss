# Deploy via git (push locally, pull on server)
deploy:
	git push && ssh jason 'cd /opt/jarvis-rss && git pull && tmux send-keys -t jarvis-rss C-c && sleep 1 && tmux send-keys -t jarvis-rss "PORT=3001 bun run start" Enter'

# Just restart the service (no code changes)
restart:
	ssh jason 'tmux send-keys -t jarvis-rss C-c && sleep 1 && tmux send-keys -t jarvis-rss "PORT=3001 bun run start" Enter'

# Pull latest and install dependencies
install:
	ssh jason 'cd /opt/jarvis-rss && git pull && bun install'

# View recent logs
logs:
	ssh jason 'tmux capture-pane -p -t jarvis-rss -S -50'

# Check service health
health:
	ssh jason 'curl -s localhost:3001/health'

# SSH to server
ssh:
	ssh jason

twitter:
	ssh jason 'cd /opt/jarvis-rss && bun run twitter'

cron-setup:
	@echo "Add these lines to crontab (crontab -e on server):"
	@echo "# Run Twitter classification 30 min after Readwise digest times (8:30 AM, 8:30 PM PST)"
	@echo "30 8,20 * * * cd /opt/jarvis-rss && ANTHROPIC_API_KEY=\$$(cat ~/.anthropic_key) READWISE_TOKEN=\$$(cat ~/.readwise_token) bun run twitter >> /var/log/jarvis-rss-twitter.log 2>&1"

.PHONY: deploy restart install logs health ssh twitter cron-setup
