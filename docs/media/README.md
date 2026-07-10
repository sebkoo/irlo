# Evidence media conventions

> **Status: Stage 0.** This directory is empty by design — no features exist, so no
> evidence exists. The conventions below govern every artifact that lands here, and
> the `make media` pipeline (Stage 1+) automates them. Never commit media showing
> real secrets, live keys, or personal data; test-mode/sandbox values only.

## Naming

One story, one slug: `us-XX-<slug>.<ext>` — for example `us-03-deck-browse.gif`,
`us-01-apply-waitlist.txt`. The expected artifacts per story are listed in the
evidence column of [`docs/user-stories.md`](../user-stories.md). PRs update that
column from "(planned)" to the committed paths.

## Size and format budgets

| Artifact | Format | Budget |
|---|---|---|
| Flow recordings (iOS or terminal) | GIF | ≤ 8 MB |
| Screenshots | PNG | keep lean; crop to the surface being proven |
| Transcripts | plain text (`.txt`) | n/a |
| Social preview | PNG, exactly 1280×640 | < 1 MB |

Optimize GIFs that overshoot: `gifsicle -O3 --lossy=80 -o out.gif in.gif`, then
re-check the budget.

## iOS capture (simulator)

Boot the Makefile's default destination first (`iPhone 16 Pro`, OS 18.0, overridable
via `IOS_SIM_DEVICE`/`IOS_SIM_OS`).

```sh
# Screenshot
xcrun simctl io booted screenshot docs/media/us-XX-<slug>.png

# Flow video (Ctrl-C to stop)
xcrun simctl io booted recordVideo /tmp/us-XX.mov
```

### Two-pass ffmpeg palette GIF pipeline

Single-pass GIF encoding dithers badly and bloats. Always use the two-pass palette
pipeline:

```sh
# Pass 1 — generate an optimized 256-color palette from the recording
ffmpeg -i /tmp/us-XX.mov \
  -vf "fps=12,scale=480:-1:flags=lanczos,palettegen" \
  /tmp/us-XX-palette.png

# Pass 2 — render the GIF using that palette
ffmpeg -i /tmp/us-XX.mov -i /tmp/us-XX-palette.png \
  -filter_complex "fps=12,scale=480:-1:flags=lanczos[x];[x][1:v]paletteuse" \
  docs/media/us-XX-<slug>.gif
```

Tune `fps` (10–15) and `scale` width downward first if the 8 MB budget is exceeded;
reach for `gifsicle --lossy` second.

## API evidence (backend stories)

Backend-surface stories (US-01, US-02, US-09, US-10 and the API halves of others)
never use screenshots. Capture instead:

- **asciinema cast → GIF** — record the request/response flow in the terminal with
  `asciinema rec docs/media/us-XX-<slug>.cast`, then render to GIF with asciinema's
  `agg` converter: `agg docs/media/us-XX-<slug>.cast docs/media/us-XX-<slug>.gif`.
  The GIF is the committed artifact; same ≤ 8 MB budget.
- **hurl / HTTPie transcripts** — save the exact request + response to
  `docs/media/us-XX-<slug>.txt`. Redact nothing that is test-mode; commit nothing
  that is not.
- **Mermaid sequence diagrams** — when a flow spans services (webhooks, queues,
  entitlement sync), embed a Mermaid diagram in the story's section of
  `docs/user-stories.md` or the relevant RFC. Diagrams live in markdown, not here.

## Alt text — required

Every image or GIF embedded in any markdown file carries meaningful alt text
describing what the evidence shows (e.g. "Terminal cast: Stripe webhook triggers
entitlement grant"). No empty brackets, no filename-as-alt-text.

## Dark-mode-safe imagery

GitHub renders READMEs in both themes. Avoid transparent backgrounds with
theme-colored content; prefer solid backgrounds, or provide theme variants via
`<picture>` with `prefers-color-scheme`. Check every image on both themes before
committing.

## Social preview

- **Spec:** 1280×640 PNG, under 1 MB. Content: Irlo logo + tagline
  ("Swipe into real life.") + a small architecture snippet from the README's Mermaid
  diagram — legible at thumbnail size, dark-mode-safe.
- **File:** keep the source at `docs/media/social-preview.png` once produced
  (planned).
- **Manual step:** GitHub has no API for this — upload it by hand in
  **Settings → General → Social preview** on the repository. Re-upload whenever the
  image changes.
