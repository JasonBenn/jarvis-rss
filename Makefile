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

.PHONY: deploy restart install logs health ssh
