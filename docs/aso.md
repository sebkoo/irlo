# ASO plan — future App Store launch

> **Status: document-only.** Irlo is not on the App Store and has not been submitted.
> This is the launch-day App Store Optimization plan, written now so metadata, media,
> and localization are decided before they are needed. Everything here is planned.

## Metadata (en-US)

| Field | Value | Limit | Count |
|---|---|---|---|
| App name | `Irlo: IRL Plans & Meetups` | 30 chars | 25 |
| Subtitle | `Swipe. Join. Show up.` | 30 chars | 21 |
| Keyword field | `meetup,local,events,friends,activities,nearby,hobby,group,chat,irl,social,plans,weekend,join,crew` | 100 chars | **97** |

Counts verified with `wc -c` on 2026-07-10. The keyword field is comma-separated with
**no spaces** — spaces waste characters Apple does not need.

Keyword rationale: the field targets intent ("meetup", "plans", "join", "nearby") and
category vocabulary ("events", "activities", "crew") rather than brand terms. Apple
also indexes the name and subtitle, so the trio works as one surface.

**Pre-submission audit (required):** before submitting, re-verify all three counts and
re-check the keyword field against the final name/subtitle for duplicated terms —
Apple guidance treats name/subtitle words as already indexed. Adjust only via an RFC.

## Screenshot storyboard — 6 shots, caption-first

Captions carry the message; screenshots prove it. Caption sits in the top third, large
enough to read at gallery size. Each shot maps to a top user story from
[`docs/user-stories.md`](user-stories.md). All shots come from real builds only — the
README truthfulness rule applies to store media too.

| # | Caption | Story | Scene |
|---|---|---|---|
| 1 | "Swipe into real life" | US-03 — Browse the Deck | Deck card stack: nearby activities with distance, time, host |
| 2 | "Right swipe means I'm in" | US-04 — Swipe to join / undo | Mid-swipe card with join confirmation; undo affordance visible |
| 3 | "Know exactly where to show up" | US-05 — Activity detail + map | Detail screen with MapKit pin and directions button |
| 4 | "The plan lives in the chat" | US-06 — Realtime group chat | Group chat with presence/typing indicators |
| 5 | "Host your own crew night" | US-11 — Host creates an activity | Create screen mid-flow, validation and autosave visible |
| 6 | "Irlo+ when you're all-in" | US-08 — Subscribe to Irlo+ | Paywall showing Irlo+ benefits (real catalog, sandbox build) |

Production notes: device frames consistent across all six; dark-mode-safe palette
(see [`docs/media/README.md`](media/README.md)); captions localized per storefront.

## App preview video — 15–30 s storyboard beats

One vertical capture, no audio dependency (captions burned in), first 3 seconds do the
selling because autoplay is muted.

| Beat | Time | Content |
|---|---|---|
| 1 | 0–3 s | Hook: a card swipes right; caption "Swipe into real life" |
| 2 | 3–8 s | Deck browsing — distance/time/host chips visible (US-03) |
| 3 | 8–13 s | Swipe right → joined confirmation → activity detail with map (US-04, US-05) |
| 4 | 13–19 s | Group chat: messages and presence moving in realtime (US-06) |
| 5 | 19–25 s | "Starting soon" push arrives → deep link straight into chat (US-13) |
| 6 | 25–30 s | Logo + name + subtitle "Swipe. Join. Show up." |

Source footage comes from the `docs/media/` evidence pipeline — the same simulator
recordings captured per story, re-cut for the store.

## Localization plan — en-US → ko-KR

en-US ships first. ko-KR is the first localization, and it starts with an unfair
advantage: **Irlo puns on 일로 (와) — "come over here"** — so the name itself reads as
an invitation to Korean speakers. Marketing copy should use the pun deliberately
rather than transliterating around it.

Plan:

1. Localize name/subtitle/keywords for the ko-KR storefront — the pun leads.
   `TODO(decide): final ko-KR app name, subtitle, and keyword field strings.`
2. Localize all six screenshot captions and the preview-video captions; re-shoot only
   if UI text is visible and localized UI exists by then.
3. Keyword research in Korean meetup vocabulary (모임, 소모임, 번개 and similar) —
   candidates only until the decision above is made.
4. App Store description written natively in Korean, not translated — same
   truthfulness bar as the README.

## Out of scope (for now)

Ratings prompts, seasonal metadata, search-ads strategy, and additional locales are
deliberately unplanned until the app is real and the en-US listing has data.
