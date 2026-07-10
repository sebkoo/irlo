# User stories → tests → evidence

> **Status: Stage 0.** Every story below is **planned — Stage 1+**. No feature code exists yet.
> This document is the contract that future work must honor.

## How this document is used

Each story maps to **named tests before implementation** — that is the TDD protocol in
`CLAUDE.md` §6. A feature PR is not mergeable until:

1. The named tests exist and pass (red → green → refactor triplets).
2. The story's evidence artifacts are captured to `docs/media/us-XX-<slug>.<ext>`.
3. The evidence column here is updated from "(planned)" to the committed paths.

The PR template enforces all three. Backend-surface stories use **API evidence** — an
asciinema cast rendered to GIF, a saved `hurl`/HTTPie transcript, and a Mermaid sequence
diagram — never screenshots. iOS-surface stories add simulator screenshots or GIFs.
Capture conventions live in [`docs/media/README.md`](media/README.md); the capture flow is
scripted by `.claude/commands/capture-media.md` and, later, `make media`.

Test naming conventions:

- Server unit/integration: `server/test/<area>/<name>.test.ts` (Vitest + supertest).
- iOS unit: `IrloTests/<Name>Tests.swift` (XCTest).
- iOS UI/E2E: `IrloUITests/<Name>UITests.swift` (XCUITest — one journey per client story).

## Story index

| ID | Story | Primary surface | Status |
|---|---|---|---|
| US-01 | Apply to join a curated crew → enters waitlist (application state machine) | API | planned — Stage 1+ |
| US-02 | Admission decision → acceptance notification; capabilities unlock via entitlements | API | planned — Stage 1+ |
| US-03 | Browse the Deck — feed API of nearby activities (distance, time, host) | API + iOS | planned — Stage 1+ |
| US-04 | Swipe right to request join / left to pass; undo via consumable | iOS + API | planned — Stage 1+ |
| US-05 | Activity detail with MapKit map + directions handoff | iOS | planned — Stage 1+ |
| US-06 | Realtime group chat (typing, presence, offline queue, backlog sync) | API + iOS | planned — Stage 1+ |
| US-07 | Buy Spark consumable via StoreKit → server verifies JWS, credits ledger | iOS + API | planned — Stage 1+ |
| US-08 | Subscribe Irlo+ via StoreKit → entitlement service grants across devices | iOS + API | planned — Stage 1+ |
| US-09 | Buy Irlo+ on the web via Stripe Checkout → entitlement syncs to iOS in seconds (dual-rail proof) | web + API | planned — Stage 1+ |
| US-10 | Cancel/refund on either rail → state machine downgrades entitlements (grace/retry visible) | API | planned — Stage 1+ |
| US-11 | Host creates an activity (validation, draft autosave) | iOS + API | planned — Stage 1+ |
| US-12 | Offline mode — cached Deck & chat backlog from CoreData | iOS | planned — Stage 1+ |
| US-13 | "Starting soon" push → deep link into chat | API + iOS | planned — Stage 1+ |

---

## US-01 · Apply to join a curated crew → enters waitlist (application state machine)

**Primary surface:** API · **Status:** planned — Stage 1+

**Given/When/Then**

- **Given** an authenticated member and an open curated crew, **when** they submit an
  application, **then** it enters the `waitlisted` state and the response validates
  against the `@irlo/contracts` schema.
- **Given** a member with an application already in flight for that crew, **when** they
  apply again, **then** the API rejects the duplicate without creating a second record.
- **Given** a closed crew, **when** a member applies, **then** the state machine refuses
  the transition and the error is a typed domain error, not a 500.

**Named tests**

- Unit — `server/test/admission/application-state-machine.test.ts` — every legal
  transition, every illegal transition rejected (100% branch — coverage gate).
- Integration — `server/test/admission/apply-endpoint.test.ts` — supertest: submit,
  duplicate, closed-crew cases; responses zod-validated.
- UI/E2E — n/a (API surface).

**Evidence artifacts**

- `docs/media/us-01-apply-waitlist.gif` — asciinema cast of the apply flow (planned)
- `docs/media/us-01-apply-waitlist.txt` — hurl transcript (planned)
- Mermaid sequence diagram, embedded here once the flow lands (planned)

## US-02 · Admission decision → acceptance notification; capabilities unlock via entitlements

**Primary surface:** API · **Status:** planned — Stage 1+

**Given/When/Then**

- **Given** a `waitlisted` application, **when** an admission decision of `accepted` is
  recorded, **then** the member's crew capabilities unlock via the entitlement service.
- **Given** an accepted application, **when** the decision commits, **then** an
  acceptance notification is enqueued exactly once (idempotent on retry).
- **Given** a `rejected` decision, **when** it is recorded, **then** no entitlement is
  granted and the audit trail captures actor + timestamp.

**Named tests**

- Unit — `server/test/admission/decision-transitions.test.ts` — accept/reject/re-review
  transitions, idempotent replay (100% branch — coverage gate).
- Integration — `server/test/admission/decision-endpoint.test.ts` — supertest: decision
  recorded, notification enqueued once, audit row written.
- Integration — `server/test/entitlements/admission-capability-unlock.test.ts` —
  entitlement grant is observable through the entitlement service, not a side table.
- UI/E2E — n/a (API surface).

**Evidence artifacts**

- `docs/media/us-02-admission-decision.gif` — asciinema cast: decide → entitlement query (planned)
- `docs/media/us-02-admission-decision.txt` — hurl transcript (planned)
- Mermaid sequence diagram (decision → notification → entitlement), embedded here (planned)

## US-03 · Browse the Deck — feed API of nearby activities (distance, time, host)

**Primary surface:** API + iOS · **Status:** planned — Stage 1+

**Given/When/Then**

- **Given** activities near the member's location, **when** the Deck feed is requested,
  **then** cards return ordered by the ranking rules with distance, time, and host data.
- **Given** an empty area, **when** the feed is requested, **then** the API returns a
  valid empty page and the iOS Deck shows its empty state.
- **Given** a feed response, **when** the iOS client renders it, **then** every card
  field comes from the `@irlo/contracts` shape — no client-side reshaping.

**Named tests**

- Unit — `server/test/deck/nearby-ranking.test.ts` — distance/time ordering rules.
- Integration — `server/test/deck/feed-endpoint.test.ts` — supertest: populated page,
  empty page, pagination cursor; zod-validated.
- iOS unit — `IrloTests/DeckViewModelTests.swift` — card mapping, empty state.
- UI/E2E — `IrloUITests/DeckBrowseUITests.swift` — launch → Deck renders cards.

**Evidence artifacts**

- `docs/media/us-03-deck-browse.gif` — simulator recording of Deck browsing (planned)
- `docs/media/us-03-deck-feed.txt` — hurl transcript of the feed request (planned)

## US-04 · Swipe right to request join / left to pass; undo via consumable

**Primary surface:** iOS + API · **Status:** planned — Stage 1+

**Given/When/Then**

- **Given** a card in the Deck, **when** the member swipes right, **then** a join
  request is recorded server-side and the card advances.
- **Given** a card, **when** the member swipes left, **then** the pass is recorded and
  the card is not re-served in the same session.
- **Given** a member with undo credits (`undo.pack10`), **when** they undo the last
  swipe, **then** one credit is debited from the ledger and the card returns.
- **Given** a member with zero undo credits, **when** they attempt undo, **then** the
  action is refused and the purchase entry point is offered.

**Named tests**

- Integration — `server/test/swipes/swipe-endpoint.test.ts` — right/left recorded,
  no re-serve within session.
- Unit — `server/test/swipes/undo-consumable.test.ts` — ledger debit, zero-balance
  refusal, idempotent retry.
- iOS unit — `IrloTests/SwipeViewModelTests.swift` — RxSwift Deck module: swipe intents,
  undo state.
- UI/E2E — `IrloUITests/SwipeUndoUITests.swift` — swipe right, swipe left, undo journey.

**Evidence artifacts**

- `docs/media/us-04-swipe-undo.gif` — simulator recording of swipe + undo (planned)
- `docs/media/us-04-swipe-api.txt` — hurl transcript of swipe/undo calls (planned)

## US-05 · Activity detail with MapKit map + directions handoff

**Primary surface:** iOS · **Status:** planned — Stage 1+

**Given/When/Then**

- **Given** a Deck card, **when** the member opens the activity detail, **then** the
  screen shows a MapKit map pinned to the venue with time and host info.
- **Given** the detail screen, **when** the member taps directions, **then** the app
  hands off to Apple Maps with the venue coordinates.
- **Given** an activity with no precise venue yet, **when** detail opens, **then** the
  map area shows the neighborhood-level fallback, not a crash or a blank.

**Named tests**

- iOS unit — `IrloTests/ActivityDetailViewModelTests.swift` — detail mapping, fallback
  handling, directions URL construction.
- UI/E2E — `IrloUITests/ActivityDetailMapUITests.swift` — open detail → map visible →
  directions control present.

**Evidence artifacts**

- `docs/media/us-05-activity-map.png` — simulator screenshot of the detail screen (planned)
- `docs/media/us-05-directions-handoff.gif` — simulator recording of the handoff (planned)

## US-06 · Realtime group chat (typing, presence, offline queue, backlog sync)

**Primary surface:** API + iOS · **Status:** planned — Stage 1+

**Given/When/Then**

- **Given** two members in an activity room, **when** one sends a message, **then** the
  other receives it over the WebSocket gateway in the same session.
- **Given** a member typing, **when** typing events fire, **then** presence and typing
  indicators propagate to the room.
- **Given** a member who goes offline, **when** messages arrive meanwhile, **then** the
  backlog syncs on reconnect with no gaps or duplicates.
- **Given** a member sending while offline, **when** connectivity returns, **then** the
  offline queue flushes in order.

**Named tests**

- Unit — `server/test/chat/room-fanout.test.ts` — fan-out to room members only.
- Unit — `server/test/chat/presence.test.ts` — join/leave/typing state in Redis.
- Integration — `server/test/chat/offline-backlog-sync.test.ts` — disconnect, send,
  reconnect: backlog complete, ordered, deduplicated.
- iOS unit — `IrloTests/ChatViewModelTests.swift` — message ordering, queue flush.
- UI/E2E — `IrloUITests/GroupChatUITests.swift` — send and receive in a room journey.

**Evidence artifacts**

- `docs/media/us-06-group-chat.gif` — simulator recording of a live chat exchange (planned)
- `docs/media/us-06-presence-cast.gif` — asciinema cast of presence/backlog over the wire (planned)
- Mermaid sequence diagram (gateway → Redis pub/sub → clients), embedded here (planned)

## US-07 · Buy Spark consumable via StoreKit → server verifies JWS, credits ledger

**Primary surface:** iOS + API · **Status:** planned — Stage 1+

**Given/When/Then**

- **Given** a member on the Spark sheet, **when** they buy `spark.single` (or
  `spark.pack5`) via StoreKit 2, **then** the client sends the signed transaction to
  the server.
- **Given** a signed transaction, **when** the server verifies the JWS against Apple's
  keys, **then** the ledger is credited append-only and the balance reflects it.
- **Given** the same transaction delivered twice, **when** the server processes the
  replay, **then** the dedupe key prevents a double credit.
- **Given** a tampered JWS, **when** verification runs, **then** the transaction is
  rejected and logged — no credit.

**Named tests**

- Unit — `server/test/payments/jws-verification.test.ts` — valid, expired, tampered
  JWS fixtures (100% branch — payments coverage gate).
- Integration — `server/test/payments/spark-ledger-credit.test.ts` — credit, replay
  dedupe, tampered rejection; ledger is append-only.
- iOS unit — `IrloTests/SparkPurchaseTests.swift` — StoreKitTest with the local
  `.storekit` config: purchase → transaction handoff.
- UI/E2E — `IrloUITests/SparkPurchaseUITests.swift` — buy Spark journey (sandbox).

**Evidence artifacts**

- `docs/media/us-07-spark-purchase.gif` — simulator recording of the purchase (planned)
- `docs/media/us-07-jws-verify.txt` — hurl transcript of the verify/credit call (planned)
- Mermaid sequence diagram (client → server → ledger), embedded here (planned)

## US-08 · Subscribe Irlo+ via StoreKit → entitlement service grants across devices

**Primary surface:** iOS + API · **Status:** planned — Stage 1+

**Given/When/Then**

- **Given** a member on the paywall, **when** they subscribe to `irlo.plus.monthly` or
  `irlo.plus.yearly`, **then** the entitlement service grants Irlo+ for the account.
- **Given** an active subscription, **when** the member signs in on a second device,
  **then** the entitlement resolves there without a new purchase.
- **Given** an App Store Server Notification V2 (renewal, revocation), **when** the
  consumer processes it, **then** the subscription state machine transitions correctly.
- **Given** a replayed notification, **when** it is consumed again, **then** processing
  is idempotent.

**Named tests**

- Unit — `server/test/payments/subscription-state-machine.test.ts` — trial → active →
  grace → billing-retry → expired/refunded (100% branch — coverage gate).
- Integration — `server/test/payments/app-store-notifications-consumer.test.ts` — JWS
  fixture notifications: renewal, revocation, replay dedupe.
- Integration — `server/test/entitlements/cross-device-grant.test.ts` — grant resolves
  for the account, not the device.
- iOS unit — `IrloTests/IrloPlusPaywallTests.swift` — StoreKitTest subscription flow,
  entitlement refresh.
- UI/E2E — `IrloUITests/IrloPlusSubscribeUITests.swift` — paywall → subscribe →
  unlocked capability journey.

**Evidence artifacts**

- `docs/media/us-08-plus-subscribe.gif` — simulator recording of the subscribe flow (planned)
- `docs/media/us-08-entitlement-sync.txt` — hurl transcript of entitlement resolution (planned)
- Mermaid sequence diagram (StoreKit → notifications consumer → entitlements), embedded here (planned)

## US-09 · Buy Irlo+ on the web via Stripe Checkout → entitlement syncs to iOS in seconds (dual-rail proof)

**Primary surface:** web + API · **Status:** planned — Stage 1+

**Given/When/Then**

- **Given** a member on the web, **when** they complete Stripe Checkout for Irlo+,
  **then** the signed webhook is verified and the entitlement service grants Irlo+.
- **Given** the granted entitlement, **when** the iOS client next syncs, **then** Irlo+
  is active on the device within seconds — same entitlement, different rail.
- **Given** a webhook with an invalid signature, **when** it arrives, **then** it is
  rejected and logged; no entitlement changes.
- **Given** a duplicate webhook delivery, **when** it is consumed, **then** the dedupe
  key makes processing idempotent.

**Named tests**

- Integration — `server/test/payments/stripe-webhook-consumer.test.ts` — signed fixture
  events: completed checkout, invalid signature, replay (100% branch — coverage gate).
- Integration — `server/test/payments/stripe-checkout-session.test.ts` — session
  creation maps catalog products to the provider-agnostic entitlement.
- Integration — `server/test/entitlements/dual-rail-sync.test.ts` — Stripe-granted
  entitlement resolves identically to a StoreKit-granted one.
- UI/E2E — n/a today (no web client yet); the cross-rail sync is proven by
  `dual-rail-sync` integration tests plus the API evidence below.

**Evidence artifacts**

- `docs/media/us-09-stripe-dual-rail.gif` — asciinema cast: checkout webhook → iOS-visible entitlement (planned)
- `docs/media/us-09-stripe-webhook.txt` — hurl transcript of the webhook + entitlement query (planned)
- Mermaid sequence diagram (Checkout → webhook → entitlements → iOS sync), embedded here (planned)

## US-10 · Cancel/refund on either rail → state machine downgrades entitlements (grace/retry visible)

**Primary surface:** API · **Status:** planned — Stage 1+

**Given/When/Then**

- **Given** an active Irlo+ subscription, **when** a cancellation lands on either rail,
  **then** the state machine schedules expiry and the entitlement downgrades on time.
- **Given** a failed renewal, **when** billing retry begins, **then** the subscription
  is observably in `grace`/`billing-retry` — queryable, not implied.
- **Given** a refund event (Apple or Stripe), **when** it is consumed, **then** the
  entitlement revokes and the ledger records the reversal append-only.
- **Given** a recovery during billing retry, **when** payment succeeds, **then** the
  subscription returns to `active` without a gap in the audit trail.

**Named tests**

- Unit — `server/test/payments/refund-downgrade.test.ts` — refund on each rail revokes
  the entitlement and writes the ledger reversal (100% branch — coverage gate).
- Unit — `server/test/payments/grace-billing-retry.test.ts` — grace/retry/recovery
  transitions, driven by Stripe test clocks and Apple notification fixtures.
- Integration — `server/test/entitlements/downgrade-propagation.test.ts` — downgrade
  visible through the entitlement API immediately after the event.
- UI/E2E — n/a (API surface).

**Evidence artifacts**

- `docs/media/us-10-cancel-refund.gif` — asciinema cast of refund → downgrade (planned)
- `docs/media/us-10-refund-transcript.txt` — hurl transcript across both rails (planned)
- Mermaid state diagram of the subscription machine, embedded here (planned)

## US-11 · Host creates an activity (validation, draft autosave)

**Primary surface:** iOS + API · **Status:** planned — Stage 1+

**Given/When/Then**

- **Given** a host on the create screen, **when** they submit a valid activity, **then**
  it is created and appears in the Deck feed for nearby members.
- **Given** invalid input (missing time, bad capacity), **when** they submit, **then**
  the zod contract rejects it with field-level errors surfaced in the UI.
- **Given** a half-finished form, **when** the host leaves the screen, **then** the
  draft autosaves and restores on return.

**Named tests**

- Unit — `server/test/activities/create-validation.test.ts` — contract-level validation
  matrix from `@irlo/contracts`.
- Integration — `server/test/activities/create-endpoint.test.ts` — supertest: create,
  reject invalid, created activity served by the feed.
- iOS unit — `IrloTests/ActivityComposerViewModelTests.swift` — field validation
  surfacing, draft autosave/restore.
- UI/E2E — `IrloUITests/HostCreateActivityUITests.swift` — fill form → leave → return →
  submit journey.

**Evidence artifacts**

- `docs/media/us-11-host-create.gif` — simulator recording of create + autosave (planned)
- `docs/media/us-11-create-api.txt` — hurl transcript of the create call (planned)

## US-12 · Offline mode — cached Deck & chat backlog from CoreData

**Primary surface:** iOS · **Status:** planned — Stage 1+

**Given/When/Then**

- **Given** a previously loaded Deck, **when** the device goes offline, **then** cached
  cards render from CoreData with an offline indicator.
- **Given** cached chat history, **when** the member opens a room offline, **then** the
  backlog renders and composed messages queue locally.
- **Given** connectivity returns, **when** sync runs, **then** queued messages send and
  the cache reconciles without duplicates.

**Named tests**

- iOS unit — `IrloTests/OfflineDeckCacheTests.swift` — CoreData round-trip, staleness
  marking.
- iOS unit — `IrloTests/ChatBacklogCacheTests.swift` — offline queue, reconcile on
  reconnect.
- UI/E2E — `IrloUITests/OfflineModeUITests.swift` — airplane-mode journey: Deck and
  chat still usable.

**Evidence artifacts**

- `docs/media/us-12-offline-deck.gif` — simulator recording with network disabled (planned)

## US-13 · "Starting soon" push → deep link into chat

**Primary surface:** API + iOS · **Status:** planned — Stage 1+

**Given/When/Then**

- **Given** a joined activity starting soon, **when** the scheduler window is reached,
  **then** a push is enqueued for each participant exactly once.
- **Given** the delivered push, **when** the member taps it, **then** the app deep-links
  directly into that activity's chat room.
- **Given** a cancelled activity, **when** the scheduler runs, **then** no push fires.

**Named tests**

- Unit — `server/test/notifications/starting-soon-scheduler.test.ts` — BullMQ job:
  window selection, exactly-once enqueue, cancelled-activity skip.
- Unit — `server/test/notifications/push-payload.test.ts` — payload matches the
  contract; deep-link target correctness.
- iOS unit — `IrloTests/DeepLinkCoordinatorTests.swift` — coordinator routes the push
  payload to the chat screen.
- UI/E2E — `IrloUITests/PushDeepLinkUITests.swift` — simulated push → chat room open.

**Evidence artifacts**

- `docs/media/us-13-push-deeplink.gif` — simulator recording of push → chat (planned)
- `docs/media/us-13-scheduler-cast.gif` — asciinema cast of the scheduler run (planned)
