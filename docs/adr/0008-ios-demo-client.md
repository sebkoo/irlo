# 0008 — iOS demo client

- Status: accepted
- Date: 2026-07-10
- Deciders: Ben Koo

## Context and problem statement

The backend is the headline; the iOS app is the proof surface for the client-facing user stories
(US-03…US-08, US-11…US-13). The target JD's stack signals both UIKit and RxSwift alongside a
modern Swift direction, so the client must demonstrate legacy fluency and migration judgment,
not just a greenfield SwiftUI app. **What exists today is only the Stage-0 shell**: an
AppDelegate/SceneDelegate UIKit skeleton whose window hosts one SwiftUI placeholder screen via
`UIHostingController`, plus canary tests. Every other feature in this ADR is planned. The
decision: app architecture, reactive strategy, persistence, and the frameworks per story.

## Decision drivers

- **D1 — JD signal fidelity**: show production UIKit and RxSwift literacy *and* a modern
  Combine/async-await direction — both sides of a real migration.
- **D2 — Navigation control**: push-driven deep links (US-13) and scripted XCUITest journeys
  need deterministic, code-owned navigation.
- **D3 — Offline-first stories**: US-12 (cached Deck + chat backlog) needs a real local store
  with merge semantics, not a dictionary in memory.
- **D4 — Testability**: unit-testable view models, one XCUITest journey per story, StoreKit
  flows testable without App Store Connect.
- **D5 — Proportionality**: the demo client must never outweigh the backend it exists to prove.

## Considered options

App shell and lifecycle:

1. **UIKit AppDelegate/SceneDelegate shell + coordinators, SwiftUI screens via `UIHostingController`** — chosen
2. SwiftUI-only `App` lifecycle with `NavigationStack`

Screen-level architecture:

3. **MVVM with coordinators (MVVM-C direction)** — chosen as direction; see outcome
4. The Composable Architecture (TCA)

Dependency management: SPM (chosen, per [ADR-0002](0002-monorepo-and-toolchain.md)) vs CocoaPods.

## Decision outcome

- **Shell (exists today)**: UIKit AppDelegate/SceneDelegate owns the `UIWindow`; screens are
  SwiftUI, mounted via `UIHostingController`. **Coordinators (planned)**: an `AppCoordinator`
  plus per-flow coordinators (Deck, Chat, Paywall) own `UINavigationController`s and construct
  hosting controllers. SwiftUI views stay navigation-free and report events to their view model;
  routing decisions live in one testable place — which is exactly what US-13's push deep link
  into a chat room requires.
- **Reactive strategy — an explicit migration story**: RxSwift is deliberately confined to the
  Deck module (planned), a fenced legacy island; **all other modules use Combine and
  async/await**. Boundary adapters (`Observable` ↔ `AsyncStream`/`Publisher`) are written once at
  the module seam, demonstrating migration in both directions. The JD lists RxSwift; this is a
  designed exhibit of living with it and leaving it, not accidental inconsistency.
- **Screen pattern**: view models + coordinators (MVVM-C) is the working direction the pack's
  coordinator decision implies. `TODO(decide): formalize the screen-state architecture (plain
  MVVM-C vs TCA) before the first non-trivial feature module — the context pack decides the
  coordinator shell, not the screen-level pattern.`
- **CoreData offline cache (planned, US-12)**: caches Deck cards and chat backlog. Sync writes
  happen on a background context; reads via fetched-results publishers. Chat rows carry the
  server's per-room sequence numbers ([ADR-0006](0006-realtime-messaging.md)) as sync cursors.
  The cache is disposable — the server is the source of truth, so migrations can be destructive.
- **MapKit (planned, US-05)**: activity detail renders a map and hands off directions to Apple
  Maps via `MKMapItem` — no third-party map SDK for a demo client (D5).
- **StoreKit 2 (planned, US-07/US-08)**: async `Product`/`Transaction` APIs and
  `Transaction.currentEntitlements` for local state; every purchase is verified server-side per
  [ADR-0004](0004-payments-platform.md) (JWS, App Store Server API v2). **StoreKitTest with a
  local `.storekit` configuration** lists the fixed catalog (`spark.single`, `spark.pack5`,
  `undo.pack10`, `waitlist.skip`, `irlo.plus.monthly`, `irlo.plus.yearly`), so purchase, restore,
  and renewal flows run deterministically in CI without App Store Connect (D4).
- **Project and dependencies**: XcodeGen `project.yml` + SPM per
  [ADR-0002](0002-monorepo-and-toolchain.md). Planned SPM dependencies: RxSwift (Deck module
  only) and swift-snapshot-testing (test targets only).

### Positive consequences

- One codebase shows UIKit shell discipline, SwiftUI feature speed, and a bounded RxSwift→Combine
  migration — the exact three-way fluency the JD implies (D1).
- Coordinators make deep links and XCUITest journeys deterministic and unit-testable (D2, D4).
- CoreData + sequence cursors give US-12 real merge semantics that demo credibly in airplane mode (D3).
- The `.storekit` config plus server-side verification exercises the full purchase path locally.

### Negative consequences

- Two reactive idioms in one app is a real cognitive tax; the module fence and one-seam adapters
  are the containment, and the fence must be lint-enforced or it will leak.
- `UIHostingController` seams (sizing, safe areas, keyboard) are a known friction cost versus a
  pure-SwiftUI app.
- CoreData is verbose for what a demo cache needs; accepted for its maturity on the iOS 17 floor.
- Deferring the MVVM-C vs TCA call risks inconsistent early screens; the TODO above must be
  resolved before the first feature module, not after several.

## Pros and cons of the options

Scores: `++` strong fit · `+` fit · `o` neutral · `–` poor · `––` disqualifying.

| Shell option | D1 JD signal | D2 navigation control | D4 testability | D5 proportionality |
|---|---|---|---|---|
| **UIKit shell + coordinators + SwiftUI screens (chosen)** | ++ (UIKit + modern SwiftUI) | ++ (code-owned routing) | ++ (coordinators unit-testable) | + (small, known-cost shell) |
| SwiftUI-only `App` + `NavigationStack` | – (no UIKit evidence) | o (path-state routing; deep-link edge cases) | + | ++ (least code) |

| Screen pattern | D1 JD signal | D4 testability | D5 proportionality |
|---|---|---|---|
| **MVVM-C direction (chosen)** | + (industry-common, matches coordinator shell) | + | ++ (no framework dependency) |
| TCA | o (strong but ecosystem-specific) | ++ (reducer tests excel) | – (framework buy-in for a demo client) |

| Dependency manager | D4 testability/CI | D5 proportionality | Longevity |
|---|---|---|---|
| **SPM (chosen)** | ++ (native `xcodebuild` integration) | ++ (zero extra tooling) | ++ (first-party) |
| CocoaPods | + | – (Ruby toolchain, `pod install`, workspace churn) | – (maintenance mode; see [ADR-0002](0002-monorepo-and-toolchain.md)) |

The SwiftUI-only shell is the strongest rejected option — it is less code and the default for new
apps — but it forfeits the UIKit signal (D1) and the coordinator's routing control (D2), the two
drivers this client exists to serve.

## Links

- [ADR-0002](0002-monorepo-and-toolchain.md) — XcodeGen + SPM, gitignored `.xcodeproj`.
- [ADR-0004](0004-payments-platform.md) — server-side verification behind the StoreKit flows.
- [ADR-0006](0006-realtime-messaging.md) — chat protocol, sequence numbers, backlog sync.
- [ADR-0007](0007-sdlc-and-operational-excellence.md) — CI matrix and coverage gates (`IrloKit` ≥ 85%).
- In-repo evidence (Stage 0): `apps/ios/project.yml`, `apps/ios/Irlo/Sources/{AppDelegate,SceneDelegate,RootView}.swift`.

## Future trends & implications

Over ~24 months, SwiftUI keeps absorbing navigation and lifecycle territory, so the UIKit shell
will read increasingly as a legacy-fluency exhibit — which is precisely its job here, and the
hosting-controller seam keeps a later SwiftUI-only migration incremental. RxSwift usage continues
to decline in favor of Combine and async/await, making the fenced-island-plus-adapters pattern
this ADR records a durable interview story about strangling a legacy dependency. SwiftData will
keep maturing on our iOS 17+ floor, and its CoreData coexistence path means the disposable cache
could migrate cheaply if it stabilizes. Swift 6 strict concurrency will tighten around
coordinators and view models, rewarding the single-seam adapter design over scattered reactive
bridging.
