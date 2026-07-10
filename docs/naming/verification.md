# Name Verification — "Irlo"

**Verdict: ✅ VERIFIED — no blocking conflict found. "Irlo" adopted as the project's working name.**

- **Verification date:** 2026-07-10 (all checks run this date unless noted)
- **Verified by:** automated availability screen (Claude Code session), recorded per check below
- **Candidate order:** Irlo → fallbacks Ilrowa (일로와) → Moija (모이자) — fallbacks not needed
- **Blocking criteria:** exact-match consumer social app on either store · high-traction GitHub repo/org in mobile/social/backend · live identical or confusingly-similar trademark in social networking (classes 9, 42, 45)

## Evidence

| # | Check | Query | URL / Method | Result | Verdict |
|---|---|---|---|---|---|
| 1 | App Store (primary) | `term=irlo&entity=software&limit=25` | `https://itunes.apple.com/search?term=irlo&entity=software&limit=25` (iTunes Search API, JSON) | 25 fuzzy results, **none named "Irlo"** — top hits are eSIM/travel apps (Airalo, Holafly, Ubigi…) | ✅ pass |
| 2 | App Store (phonetic neighbors) | `irio`, `iloo`, `ilo`, `irl` via same API | same API, one query per term | No "Irlo". `IRIO` = B2B business platform; `ILOO` = FR travel; `ilo` = digital business card; `irl` returns the crowded generic-acronym cluster (IRL: In Real Life, HIRL, Timeleft) — none confusable with a coined "Irlo" | ✅ pass |
| 3 | Play Store | `"irlo" app site:play.google.com` | Google-indexed web search | No "Irlo" app; nearest are Iryo (rail travel), IRL Pro (streaming tool), Arlo (home security) | ✅ pass |
| 4 | GitHub repos | `gh search repos irlo` | GitHub Search API | No traction repo in mobile/social/backend; hits are IR-lock firmware (3★), impulse-response loaders, IR loggers, profile stubs | ✅ pass |
| 5 | GitHub namespace | `gh api users/irlo`, `gh api repos/sebkoo/irlo` | GitHub REST API | User `irlo` exists but is inactive (2 empty untitled repos, 0 stars). `sebkoo/irlo` **available** — our namespace suffices per decision rule | ✅ pass |
| 6 | npm | `npm view irlo` (also `irlo-app`) | npm registry | E404 — name free | ℹ️ informational |
| 7 | CocoaPods | `GET /api/v1/pods/irlo` | `https://trunk.cocoapods.org` | HTTP 404 — name free | ℹ️ informational |
| 8 | Swift Package Index | `search?query=irlo` | `https://swiftpackageindex.com` | HTTP 403 (blocks non-browser fetch) — not verifiable non-interactively; SPM has no reserved global namespace, so low relevance | ℹ️ informational, caveat |
| 9 | Domain irlo.app | RDAP lookup | `https://rdap.org/domain/irlo.app` | HTTP 404 — **unregistered / available**. Recorded only; not purchased | ✅ recorded |
| 10 | Domain getirlo.app | RDAP lookup | `https://rdap.org/domain/getirlo.app` | HTTP 404 — **unregistered / available**. Recorded only; not purchased | ✅ recorded |
| 11 | USPTO (classes 9/42/45) | `site:trademarks.justia.com IRLO` + `"IRLO" trademark social networking` | Justia (indexed USPTO mirror) via web search; direct TESS/Justia scraping returns 403 | **No IRLO mark found.** Nearest strings: IRROZOL, IROIRO, IREENUO, IRGASOL — different marks, unrelated goods/services | ✅ pass, caveat: indexed-mirror screen, not an authoritative live TESS session |
| 12 | KIPRIS (KR, classes 9/42/45) | `"irlo" 상표 KIPRIS 출원` | web search; direct KIPRIS query requires an interactive session (no free non-interactive API) | No IRLO mark surfaced. **Flagged for manual KIPRIS session before any commercial use** | ⚠️ best-effort pass, manual re-check flagged |

<details>
<summary>Raw iTunes Search API excerpt — term "irlo" (evidence for check #1)</summary>

```
resultCount: 25 — top results (trackName — artistName [genre]):
  Airalo: eSIM for travel & data — Airalo [Travel]
  Holafly eSIM: Unlimited Data — HOLAFLY LIMITED [Travel]
  Monty eSIM: Travel Internet — MONTY UK GLOBAL LIMITED [Travel]
  GIANT: eSIM Mobile Data Plan — ShareG, Inc [Travel]
  Instabridge: eSIM + Internet — Instabridge Sweden AB [Travel]
  Ubigi: Travel eSIM mobile data — Transatel [Travel]
  Klook: Travel & Activities — Klook Travel Technology Limited [Travel]
  Roamless: eSIM Travel Internet — MYNE Technologies Inc [Travel]
  Nomad eSIM: Prepaid Data Plan — LotusFlare [Travel]
  Simly: eSIM Travel Data Plans — Simly [Travel]
(no result named "Irlo"; full JSON reproducible via the API URL above)
```

</details>

## Confusion analysis

"IRL" is a generic acronym already used by several unrelated apps (IRL: In Real Life, IRL Pro, HIRL), so no single party owns the concept. The coined mark "Irlo" differs from each in sight (distinct 4-letter word, no acronym styling), sound (/ˈɜːr.loʊ/, two syllables — 얼로/일로), and commercial impression (an invented name, not an initialism). No app, mark, or high-traction project named "Irlo" exists in the social/meetup space as of the verification date. The Korean pun 일로 (와) — "come over here" — adds bilingual memorability and distinctiveness rather than collision, since it is a colloquial phrase, not an existing brand. Residual risk is limited to the unscreened interactive KIPRIS session (#12), judged low for a coined term.

## Decision

**Adopt "Irlo".** No blocking failure under §3 decision rules; fallbacks (Ilrowa, Moija) remain documented but unused. Re-run this screen before any commercial launch — stores and registers change continuously.

---

> **Disclaimer:** This document is a good-faith availability screen performed with public, free sources on the date above. It is **not legal advice** and not a clearance opinion. Commission a trademark attorney (US + KR) for a full knock-out search and filing strategy before any commercial launch.
