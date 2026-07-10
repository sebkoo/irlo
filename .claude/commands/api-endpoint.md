---
description: Add an API endpoint contract-first (zod schema → failing supertest → implementation)
argument-hint: <METHOD /path> <one-line purpose>
---

Add the endpoint **$ARGUMENTS** contract-first:

1. **Contract.** Define request/response zod schemas in `packages/contracts/src/`
   (one file per resource; export from `index.ts`). Params, query, body, response,
   and error shape all get schemas. Add a schema canary test in the contracts
   package. Commit: `feat(contracts): add <resource> schemas for <METHOD path>`
2. **Red.** In `server/`, write the failing supertest integration spec against the
   app factory: happy path + each 4xx the contract implies + one malformed-input
   case proving zod rejection at the boundary. Quote the red run in the commit body.
   Commit: `test(server): failing spec for <METHOD path>`
3. **Green.** Implement route + handler: parse with the contract schemas at the
   boundary, keep domain logic in a pure function that takes parsed input, wire
   structured logging. No `any`, no hand-written shapes.
   Commit: `feat(server): implement <METHOD path>`
4. **Refactor** if the handler grew beyond parse → domain call → serialize.
5. Verify coverage gates still pass (`pnpm -r test:coverage`), run the
   `code-reviewer` agent, and update `docs/user-stories.md` evidence column if this
   endpoint completes a story.
