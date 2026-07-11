# macOS toolchain for the iOS demo client and evidence pipeline.
# node/pnpm are pinned in .mise.toml, not here.
brew "xcodegen"
brew "swiftlint"
brew "swiftformat"
brew "ffmpeg"   # GIF evidence pipeline (make media)
brew "gh"       # GitHub CLI (publishing, CI watch)

brew "asciinema"       # terminal casts for API evidence (Stage 1+)
# postgres/redis dev env (C19). Docker Desktop is blocked on this managed
# machine (cask install fails on the credential-helper linking step under
# sudo) — colima is the supported local runtime instead. Setup + gotchas:
# docs/runbook.md #Local dev environment (colima).
brew "colima"
brew "docker"
brew "docker-compose"
