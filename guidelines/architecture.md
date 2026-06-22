# Architecture Guidelines

These rules apply to every change on zava-storefront. Both `build-pr` and
`panel-review` read this file before producing output.

## Dependencies

- **New external `npm` dependencies need an ADR.** Create
  `docs/decisions/YYYY-MM-DD-<short-name>.md` using the ADR template before
  the PR is opened. The ADR must answer: why this library, what alternatives
  were considered, what's the exit strategy if we need to remove it.
- Internal packages (`lib/*`) may not add circular dependencies on each other.
  Run `npm run lint` — it catches cycles via the ESLint import plugin.

## Layer boundaries

- **No cross-layer imports.** The import direction is strictly:
  `app/` → `lib/` → (external packages). `lib/` code must never import from
  `app/`. Route handlers (`app/api/`) must never import from another route
  handler — extract shared logic into `lib/`.
- DB access lives exclusively in `lib/db/` or dedicated repository modules
  under `lib/`. Route handlers call repository functions, not the `pg` client
  directly.
- Business logic lives in `lib/`, not in route handlers. A handler should
  validate input, call a `lib/` function, and return the result — nothing more.

## Bounded contexts

- Each bounded context (e.g. `orders`, `catalogue`, `accounts`) owns its own
  DB queries. Context A must not directly query Context B's tables — go
  through Context B's public `lib/` API instead.
- New contexts get their own subdirectory under `lib/` and an entry in
  `docs/architecture.md`.

## Routing

- New HTTP routes go in `app/api/` following Next.js App Router conventions
  (`route.ts` per segment, named exports for `GET`, `POST`, etc.).
- No custom Express-style middleware chains — use Next.js middleware or
  per-handler auth helpers from `lib/auth/`.

## State

- **No global mutable state** in `lib/` modules. Module-level `const` for
  immutable config is fine; mutable singletons that accumulate state across
  requests are not.
- Caches must have a bounded size and a TTL. Unbounded in-memory caches are
  a memory-leak finding.

## Testing

- Every new feature needs at least one unit test in `tests/` covering the
  happy path and at least one error path.
- Tests must not make real network calls or hit a real DB — use the mocks
  in `tests/fixtures/`.
- A PR that adds business logic without a test is not ready for merge.

## Operability

- A change that introduces a new failure mode must also add or update
  `docs/runbook.md` with: the symptom, the immediate mitigation, and the
  long-term fix.
- New configuration values need a documented default and a startup validation
  check that fails fast with a clear message if the value is missing.
