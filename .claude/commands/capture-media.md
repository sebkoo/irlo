---
description: Capture evidence media (GIF/screenshot/cast/transcript) for a user story
argument-hint: <story-id, e.g. US-03>
---

Capture evidence for **$ARGUMENTS** per `docs/media/README.md` conventions.

1. Read the story's evidence column in `docs/user-stories.md` — it names the exact
   artifacts expected (`docs/media/us-XX-*`).
2. **iOS surfaces:** boot the simulator from the Makefile destination, then
   - screenshot: `xcrun simctl io booted screenshot docs/media/us-XX-<slug>.png`
   - flow video: `xcrun simctl io booted recordVideo /tmp/us-XX.mov` (Ctrl-C to stop),
     then GIF ≤ 8 MB via the two-pass ffmpeg palette pipeline in `docs/media/README.md`.
3. **API surfaces:** no screenshots — capture
   - an asciinema cast of the request/response flow → GIF,
   - the saved `hurl`/HTTPie transcript into `docs/media/us-XX-<slug>.txt`,
   - a Mermaid sequence diagram in the story's docs section when the flow spans
     services (webhooks, queues).
4. Optimize (gifsicle/ffmpeg), verify size budgets, add alt text where embedded.
5. Update the story's evidence column from `planned` to the committed paths.
6. Commit: `docs(media): add $ARGUMENTS evidence` — never commit media that shows
   real secrets, live keys, or personal data; test-mode values only.
