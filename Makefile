sync:
	rsync -azv --exclude 'node_modules' --exclude '.git' /Users/jasonbenn/code/jarvis-rss/ jason:/opt/jarvis-rss/

restart:
	ssh jason 'tmux send-keys -t jarvis-rss C-c && sleep 1 && tmux send-keys -t jarvis-rss "PORT=3001 ~/.bun/bin/bun run src/index.ts" Enter'

deploy: sync restart

install:
	ssh jason 'cd /opt/jarvis-rss && ~/.bun/bin/bun install'

logs:
	ssh jason 'tmux capture-pane -p -t jarvis-rss -S -50'

.PHONY: sync restart deploy install logs
