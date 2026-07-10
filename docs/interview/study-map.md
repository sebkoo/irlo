# Study map — 14 resources → Irlo → interview drills

> Internal interview-prep notes. Raya is referenced only inside `docs/interview/`.
> Irlo is an independent portfolio project, not affiliated with Raya.

Each resource earns its place twice: it feeds a repo artifact, and it feeds an
interview drill. Canonical repos mapped 2026-07-10 (shortlinks resolved by label).

| # | Label | Canonical repo | Extract for Irlo | Interview drill |
|---|---|---|---|---|
| 1 | System design | `donnemartin/system-design-primer` | Scalability vocab for ADRs | Payments platform, waitlist, chat fan-out |
| 2 | Public APIs | `public-apis/public-apis` | Seed/demo data sources | API selection trade-offs |
| 3 | Tech interview handbook | `yangshun/tech-interview-handbook` | Behavioral (STAR), resume, negotiation | 2 STAR stories per JD bullet |
| 4 | Coding interview university | `jwasham/coding-interview-university` | DS&A refresh checklist | Daily 1 problem in TypeScript |
| 5 | Engineering leadership | `charlax/engineering-management` — verified 2026-07-10 via GitHub API: 8,321 stars, last push 2026-06-01 | Senior ownership/leadership signals | "Empathetic leader" stories |
| 6 | freeCodeCamp | `freeCodeCamp/freeCodeCamp` | README/community patterns; production Node codebase reading | — |
| 7 | Developer roadmaps | `kamranahmedse/developer-roadmap` | Node.js/backend roadmap gap check | Self-assessment matrix |
| 8 | Path to senior handbook | `jordan-cutler/path-to-senior-engineer-handbook` | Senior competency matrix → repo evidence | Promotion-packet narrative |
| 9 | Free programming books | `EbookFoundation/free-programming-books` | Node/TS/distributed-systems shelf | — |
| 10 | n8n | `n8n-io/n8n` | The best production Node/TS monorepo to study among the 14 — architecture, queues, licensing (fair-code) | Large-codebase walkthrough answers |
| 11 | Open WebUI | `open-webui/open-webui` | Demo-GIF-first README; local LLM harness | — |
| 12 | Transformers | `huggingface/transformers` | Docs IA; embeddings for Deck ranking (pgvector, planned) | AI-feature design Q |
| 13 | AutoGPT | `Significant-Gravitas/AutoGPT` | Agent-loop patterns → the AI-native harness | Agentic workflow explanation |
| 14 | TensorFlow | `tensorflow/tensorflow` | Badge/CI conventions at scale | — |

## How to use this map (weekly cadence)

- **Daily:** one TypeScript problem from row 4. Small, timed, no exceptions.
- **Weekly:** two design drills (`design-drills.md`), warmed up with row 1 vocab.
- **Weekly:** one hour reading a production codebase — rotate rows 10–14, start with row 10 (n8n).
- **Weekly:** one row 3 session — draft STAR stories until every JD bullet has two.
- **Bi-weekly:** rows 7–8 gap check; convert each gap into a planned repo artifact.
- **On demand:** rows 2, 6, 9, 14 are reference shelves, not scheduled reading.
- Slot all of the above into the 4-week plan in `raya-prep.md`.

## AI-tools evidence note

Rows 10–14 evidence the JD bullet "enthusiasm around new AI tools and frameworks":
studying live AI codebases (n8n, Open WebUI, Transformers, AutoGPT, TensorFlow) feeds
Irlo's planned embeddings ranking and moderation features. Cite them in
`docs/ai/methodology.md` (the AI-native loop).
