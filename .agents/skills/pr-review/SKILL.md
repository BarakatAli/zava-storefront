---
name: pr-review
description: "Reviews an open GitHub PR against team security, architecture, and documentation guidelines. Output always follows a fixed structure: verdict → reason → findings ordered by criticality, per dimension. Opens the pr-review canvas to render the full report."
---

# pr-review

Review an open GitHub pull request against the three team guideline files and
render the result in the **pr-review** canvas panel. Output is always in the
same fixed structure so reviewers can scan consistently across PRs.

## When to use

- A PR is open on GitHub and needs a structured review.
- You want findings mapped explicitly to team guidelines (not just general
  best-practice advice).
- The diff may be large — the skill handles that without losing coverage.

## Invocation

```
/pr-review #<number>
```

Examples:
```
/pr-review #3
/pr-review #12   focus: security
```

The optional `focus:` hint narrows which dimension gets the most depth.
Without it all three dimensions are reviewed equally.

## Output structure (always)

```
VERDICT  ✅ Merge  |  ⛔ Request Changes

WHY
<1–3 sentences explaining the overall verdict>

FINDINGS  (ordered: critical → high → medium → low → info)

  🔴 SECURITY
    [CRITICAL] …
    [HIGH]     …

  🟡 ARCHITECTURE
    [MEDIUM]   …

  🟢 DOCUMENTATION
    [LOW]      …
    [INFO]     No issues found.
```

Rules that never change:
- Every dimension must appear, even if clean (use `[INFO] No issues found.`).
- `verdict` is `REQUEST_CHANGES` if ANY finding is critical or high; `MERGE`
  otherwise.
- Findings within a dimension are sorted most-critical first.

---

## Process

### Phase 0 — Setup (always first)

1. Open the canvas panel so the user sees progress immediately:
   ```
   open_canvas(
     canvasId: "pr-review",
     instanceId: "pr-review-<N>",
     input: { prNumber: <N> }
   )
   ```
2. Read all three guideline files — they are the review standard:
   - `guidelines/security.md`
   - `guidelines/architecture.md`
   - `guidelines/documentation.md`

### Phase 1 — PR triage

```bash
gh pr view <N> --json title,author,additions,deletions,changedFiles,body,headRefName,url
gh pr diff <N>
```

**Large-PR strategy** — if the diff is large (many files / hundreds of lines
per file), do not try to review everything at equal depth. Prioritise:

| Priority | Files |
|----------|-------|
| 1 — Highest | Auth/session handlers, middleware, anything touching secrets or DB access |
| 2 | New `app/api/` route handlers |
| 3 | `lib/` business-logic changes |
| 4 | Tests, config, infra, deps, docs |

Review priority-1 and priority-2 files at full depth. For priority-4 files a
lighter skim is acceptable. Always note in the `reason` field if the diff was
too large for full coverage.

### Phase 2 — Dimensional review

For each dimension, apply only the rules from the corresponding guideline file
(not general instinct). Quote or reference the specific rule that is violated.

#### 🔴 Security (`guidelines/security.md`)
Focus on: input validation at every boundary, no secrets in code, parameterized
queries, explicit authN+authZ on every handler (or `// PUBLIC ROUTE` annotation
if intentionally public), structured logging with correlationId, PII masking,
no stack traces in API responses.

#### 🟡 Architecture (`guidelines/architecture.md`)
Focus on: layer boundary violations (`app/` → `lib/` → packages only), no
cross-context DB queries, business logic in `lib/` not in handlers, new
external deps require an ADR, bounded contexts registered in
`docs/architecture.md`, no global mutable state, unit tests for every new
feature (happy path + at least one error path).

#### 🟢 Documentation (`guidelines/documentation.md`)
Focus on: TSDoc on all exported functions/types in `lib/` and `app/api/`,
`@param`/`@returns`/`@throws`/`@example` completeness, README updated for
user-facing changes, new routes in `docs/api.md`, ADRs for significant
decisions, no stale examples.

### Phase 3 — Verdict and render

1. Aggregate all findings from the three dimensions.
2. Sort the combined list: `critical` → `high` → `medium` → `low` → `info`.
3. Compute verdict:
   - `REQUEST_CHANGES` if any finding has severity `critical` or `high`.
   - `MERGE` otherwise.
4. Push the structured report to the canvas:
   ```
   invoke_canvas_action(
     instanceId: "pr-review-<N>",
     actionName: "submit-review",
     input: {
       pr: { title, author: { login }, additions, deletions, changedFiles },
       report: {
         verdict: "MERGE" | "REQUEST_CHANGES",
         reason: "<1–3 sentences>",
         findings: [
           { dimension, severity, title, detail },
           …
         ]
       },
       truncated: true | false   ← set true if diff was too large for full coverage
     }
   )
   ```
5. Post a compact summary in chat:
   ```
   **PR #N — <title>**
   Verdict: ✅ Merge  /  ⛔ Request Changes

   Top findings:
   - [<severity>] <dimension>: <title>
   - …  (up to 3 most critical)

   Full report → pr-review canvas panel.
   ```

---

## Hard rules

- **Never invent findings.** Every finding must cite the specific guideline rule
  it violates. If nothing violates a rule, say so explicitly with `[INFO]`.
- **Severity is honest.**
  - `critical`: security vulnerability or data loss risk — do not merge.
  - `high`: clear guideline violation that must be fixed before merge.
  - `medium`: should be fixed in this PR but won't block if acknowledged.
  - `low`: housekeeping — fix in a follow-up is acceptable.
  - `info`: observation only, no action required.
- **Large-PR coverage is disclosed.** If you reviewed only a subset of files,
  say so in the `reason` field and list which file groups were skipped.
- **Do not auto-approve or auto-merge.** This skill produces a report; the human
  decides what to do with it.

---

## Canvas

The `pr-review` canvas (`project:pr-review`) renders the report as a
colour-coded panel with findings grouped by dimension. It is opened in Phase 0
and populated via `submit-review` in Phase 3. The canvas caches the report for
the session so `invoke_canvas_action(get-report)` returns it as JSON for
further processing.

---

## See also

- `guidelines/security.md` — security rules applied in Phase 2
- `guidelines/architecture.md` — architecture rules applied in Phase 2
- `guidelines/documentation.md` — documentation rules applied in Phase 2
- `panel-review` skill — pre-push review of *staged* changes (different trigger)
- `.github/extensions/pr-review/extension.mjs` — the canvas extension
