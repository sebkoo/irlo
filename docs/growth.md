# Growth — ethical distribution plan

> **Status: plan.** The repo is Stage 0 (scaffolding + canary tests). Nothing below
> executes until the milestone next to it is real. No channel gets a post about
> features that do not exist.

## Ethics first — the rules this plan lives under

Growth targets here are **outcomes, not manipulations**. Concretely:

- **No star-farming.** No star-for-star trades, no "please star" DMs, no incentives.
- **No fake accounts.** Every post, comment, and reply comes from the maintainer,
  identified as the maintainer.
- **No engagement bait.** No rage-posting, no fake controversy, no growth-hack
  threads that overpromise. If the work isn't interesting, the post waits.
- **Community rules win.** Every subreddit, HN, and awesome-list has submission
  rules; read them before posting, and skip the channel if self-promotion is
  unwelcome that week.
- **Truthful claims only** — the README rule extends to every external post: no
  metrics, badges, or capabilities that are not real at post time.
- **Non-affiliation disclaimer travels.** Every public description of the project
  carries the "independent portfolio project, not affiliated with Raya" line.

Stars and forks are trailing indicators we *observe*, not numbers we chase.

## The plan, keyed to milestones

### Now (Stage 0) — make the repo worth finding

- README, topics, and description tuned for search (spec §8.5); social preview image
  per [`docs/media/README.md`](media/README.md).
- Seed **5 good-first-issues** so the first visitor has a way in. Candidates (final
  list confirmed when seeded, each with context + acceptance criteria):
  1. Add a `hurl` example collection for the health endpoint.
  2. Add a Markdown link-checker job to CI.
  3. Extend the `HealthStatus` contract with a version field (contract-first walkthrough).
  4. Script the two-pass ffmpeg GIF pipeline behind `make media`.
  5. Add an `accessibilityID` audit checklist for iOS UI-test hooks.

### v0.1.0 — the demo-GIF moment

Timed to the first release with a real 30-second demo GIF (nothing launches on
promises):

- **Launch article on dev.to** — the engineering story (dual-rail payments,
  contract-first TDD, building in public with an AI harness), demo GIF up top.
- **Korean summary on velog** — same story, natively written, leading with the
  일로 (와) pun and the Korean dev audience's angle.
- **Show HN** — posted once, plainly titled, maintainer in the comments all day.
- **r/node, r/typescript, r/iOSProgramming** — staggered over days, each post angled
  to that community (backend architecture / strict TS patterns / UIKit+SwiftUI
  client), each respecting the subreddit's self-promotion rules.

### ≥ MVP — durable listings

Once the app meaningfully works end-to-end:

- **dkhamsing/open-source-ios-apps** — submit the iOS client (their bar: a complete,
  buildable app; submit only when it honestly qualifies).
- **awesome-nodejs** and **awesome-typescript** — submit only if the server clears
  each list's notability rules at that time; skip rather than lobby.

### Ongoing — build in public, weekly

- A weekly build-in-public thread: what shipped, what broke, one honest metric or
  velocity note, and the week's evidence GIF. Cadence matches the weekly tagged
  release habit.
- `TODO(decide): platform for the weekly build-in-public thread (X, Bluesky, Threads, or LinkedIn).`

## Measurement

Trailing indicators only, reviewed monthly, no targets that could incentivize
manipulation: stars/forks/watchers, unique cloners, referrer traffic to the repo,
good-first-issue pickups, and inbound issues/PRs from strangers. The interesting
number is *strangers who found it useful* — everything else is vanity.
