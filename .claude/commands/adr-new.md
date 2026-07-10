---
description: Create a new MADR-format Architecture Decision Record
argument-hint: <short decision title>
---

Create the next ADR in `docs/adr/` for: **$ARGUMENTS**

1. Number = highest existing ADR + 1, zero-padded to 4 digits; filename
   `NNNN-kebab-case-title.md`.
2. Use MADR format with these sections exactly:

```markdown
# NNNN — <Title>

- Status: proposed | accepted | superseded by [NNNN](...)
- Date: <YYYY-MM-DD>
- Deciders: Ben Koo

## Context and problem statement
## Decision drivers
## Considered options
## Decision outcome
### Positive consequences
### Negative consequences
## Pros and cons of the options   <!-- trade-off table REQUIRED for ≥2 options -->
## Links
## Future trends & implications   <!-- REQUIRED — the "Visionary" signal -->
```

3. The trade-off table must score options against the decision drivers, not
   generic pros/cons. Cite real, current sources for claims about ecosystem
   maturity (verify versions/dates — no stale training-data facts).
4. "Future trends & implications" (3–6 sentences): where this technology/domain is
   heading over ~24 months and how the decision holds up.
5. Add the ADR to the index table in `docs/adr/README.md` (create if missing).
6. Commit: `docs(adr): record NNNN <title>` — body summarizes the decision one-line
   and the strongest rejected alternative.
