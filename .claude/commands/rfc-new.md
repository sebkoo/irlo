---
description: Open a new RFC from the template for a substantial design change
argument-hint: <proposal title>
---

Create a new RFC in `docs/rfc/` for: **$ARGUMENTS**

1. Copy `docs/rfc/0000-template.md` to `NNNN-kebab-case-title.md` (next number).
2. Fill every section; delete none. Required content:
   - **Problem** — user/system pain with data or a concrete failure story.
   - **Proposal** — the design, with a Mermaid diagram when state or flow changes.
   - **Contracts** — new/changed zod schemas in `@irlo/contracts`, shown as code.
   - **Test plan** — named tests per §6, mapped to user stories.
   - **Rollout** — flags, migration, revert path, observability (what metric proves
     success/failure).
   - **Alternatives** — at least two, with why-not.
3. Status lifecycle: `draft → review → accepted/rejected` (update the header line).
4. Commit: `docs(rfc): propose <title>`; open a PR so review happens in public even
   when self-merging — the review culture is part of the evidence.
