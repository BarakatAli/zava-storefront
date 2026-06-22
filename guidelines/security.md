# Security Guidelines

These rules apply to every change on zava-storefront. Both `build-pr` and
`panel-review` read this file before producing output.

## Input validation

- **Never read request input without validation.** Every field from
  `request.body`, `request.query`, `request.params`, cookies, and headers
  must be validated with a Zod schema (or equivalent) at the route boundary
  before it touches any business logic or DB call.
- Reject and return `400` immediately on invalid input. Log the violation at
  `WARN` with the field name — never the raw value.
- Validate on the way in, encode on the way out. HTML-escape anything that
  reaches a template; JSON-encode anything that reaches a JSON response.

## Secrets and credentials

- **No secrets in code.** No API keys, tokens, passwords, or connection
  strings in source files, `.env.example`, test fixtures, or comments.
  Use `process.env.MY_SECRET` backed by Azure Key Vault at runtime and
  GitHub OIDC in CI. If you spot a secret in a diff, stop — rotate the
  credential before the PR is merged.
- Reference secrets by name only: `process.env.DATABASE_URL`, never inline.
- Pin all secrets usage to named env-var constants defined in one place
  (e.g. `lib/config.ts`) so a grep proves coverage.

## Database queries

- **Parameterize every query.** Use `pg` placeholders (`$1`, `$2`, …) or an
  ORM's parameter API. String concatenation into SQL is a blocker finding.
- Never SELECT `*` across trust boundaries — name every column.

## AuthN / AuthZ

- Every new HTTP handler must explicitly call the session/auth check and an
  authorisation check before touching data. No handler is "public by default"
  — annotate public routes with a `// PUBLIC ROUTE` comment so the absence is
  intentional.
- Default deny: if an auth check throws or returns falsy, the handler must
  return `401` or `403` and stop — never fall through.

## Error handling

- Return a generic error message + a `correlationId` to the client.
  The full cause chain goes to the structured log only — never in the
  response body.
- On any error inside an auth or authz check, the answer is **deny**,
  not pass-through.

## Logging and PII

- Never log full PII: mask emails (`a***@d***.com`), payment data, session
  tokens, passwords. Log the field name and a redacted marker instead.
- Structured JSON logs only. Required fields: `correlationId`, `userId`
  (hashed), `operation`, `latencyMs`, `outcome`.
- No `console.log` in production code paths — use the structured logger.

## Dependencies

- New `npm` dependencies must be pinned to an exact version in `package.json`
  (no `^` or `~` in production deps).
- Every new dependency needs a one-line justification in the PR description:
  why this package, why now, what alternatives were ruled out.
