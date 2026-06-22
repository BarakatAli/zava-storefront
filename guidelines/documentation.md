# Documentation Guidelines

These rules apply to every change on zava-storefront. Both `build-pr` and
`panel-review` read this file before producing output.

## Source-code docstrings

- **Public functions need a doc comment.** Every exported function, class, and
  type in `lib/` and `app/api/` must have a TSDoc comment that answers:
  1. What does it do? (one line)
  2. What are the parameters and return value?
  3. What exceptions or error codes can it produce?
  4. One short `@example` for non-trivial APIs.
- Internal helpers need a comment only when the intent is non-obvious from the
  name and body. Skip trivial one-liners.
- No stale examples. If you change a function's signature, update the
  `@example` in the same commit.

Format:

```ts
/**
 * Fetches a product by its catalogue ID.
 *
 * @param id - The UUID of the product.
 * @returns The product record, or `null` if not found.
 * @throws {DatabaseError} If the DB query fails.
 * @example
 *   const product = await getProduct("abc-123");
 */
export async function getProduct(id: string): Promise<Product | null> { … }
```

## README

- **User-facing changes update the README.** If a change affects how
  developers set up, run, or use the application, update `README.md` in the
  same PR. "User-facing" includes: new env vars, changed CLI commands, new
  API endpoints visible to clients, changed authentication flows.
- Keep the README's "Quick start" section runnable end-to-end. If you break
  the quick start, fix it before merging.

## API documentation

- New or changed API routes must be reflected in `docs/api.md` (or the
  OpenAPI spec if one exists). Auto-generate where possible; hand-maintain
  only when generation is not feasible.
- Document: HTTP method, path, request body schema, response schema, error
  codes, and auth requirements.

## Architectural decisions

- New external dependencies and significant design choices go in
  `docs/decisions/` as an ADR. File name: `YYYY-MM-DD-<short-title>.md`.
  Minimum content: context, decision, alternatives considered, consequences.

## Changelog

- **Breaking changes get a `CHANGELOG.md` entry** under an `## Unreleased`
  section. Non-breaking additions can be noted; pure internal refactors need
  not be.

## Style

- Plain English. Short sentences. Active voice.
- Second person ("you") for guides; third person for API reference.
- No marketing copy — "blazing fast" and "robust" are banned. Specifics only.
- Code examples must be runnable as-is or link to the quick-start for any
  required setup.
- Mermaid for inline diagrams; Excalidraw (PNG + source) for richer visuals.
  No screenshots of code — use fenced code blocks.
