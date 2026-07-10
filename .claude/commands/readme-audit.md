---
description: Audit README.md for truthfulness, readability, and SEO before a release
---

Audit `README.md` line by line. Produce a findings table (line · issue · fix), apply
agreed fixes, commit as `docs(readme): <summary>`.

**Truthfulness (release-blocking)**
- Every badge resolves and reflects reality (no coverage badge without coverage in CI;
  no version badge that contradicts lockfiles/configs).
- Every feature claim maps to merged code or is explicitly labeled *(planned)* /
  *(placeholder)*. Screenshots/GIFs show the current build, not mockups presented as real.
- Getting-started commands work verbatim on a clean clone — actually run them.
- Stats/citations: link to the primary source; publication date within ~2 years.

**Readability (§8 rules)**
- TOC anchors resolve; sentences ≤ 24 words; alt text on every image; long tables
  collapsed in `<details>`; images legible in dark mode; no badge walls.

**SEO/discoverability**
- Title/tagline carry the searchable phrases naturally (meetup platform, payments,
  StoreKit, Stripe, TypeScript, iOS); FAQ questions match long-tail queries;
  repo description + topics (§8.5) still match the README's story.

Output ends with a verdict: `SHIP` or `FIX FIRST` + the blocking items.
