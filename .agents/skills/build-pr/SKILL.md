---
name: build-pr
description: "Implement a work item (feature brief or review findings) as commits on a new branch and open or update a pull request on zava-storefront. Reads the team's security, architecture, and documentation guidelines before writing any code. Runs npm run lint and npm test; fixes failures before opening the PR. Anything beyond the work item's scope is noted in the PR description for a human, not built."
license: MIT
metadata:
  author: "Zava Engineering"
  source: "Zava platform team"
---

# build-pr

Given a work item — either a short feature brief or a set of review findings
to address — implement the change as commits on a new branch and open (or
update) a pull request on **zava-storefront**. The skill reads the team's
three guideline files before writing a single line, runs the project checks,
and fixes any failures before the PR is opened. Anything outside the work
item's stated scope is noted in the PR description for a human to action
separately.

## Architecture

```
INPUT
  │
  ├── feature brief  (free text or file path)
  └── review findings  (panel-review / pr-review output)
  │
  ▼
1. PARSE work item + scope-check
   Extract: title, scope, acceptance criteria, out-of-scope list
  │
  ▼
2. LOAD guidelines (read once, thread through every step)
   ├── guidelines/security.md       (security rules)
   ├── guidelines/architecture.md   (architecture rules)
   └── guidelines/documentation.md  (documentation rules)
  │
  ▼
3. BRANCH   git checkout -b feat/<slug>   (fix/<slug> for findings)
  │
  ▼
4. IMPLEMENT  (per feature chunk or per finding)
   Code written against all three guideline files simultaneously
  │
  ▼
5. CHECK LOOP  (max 3 self-repair attempts)
   npm run lint  ──red?──► fix  ──┐
        │                         │
       green                      │
        │                         │
   npm test      ──red?──► fix  ──┘
        │
       green (or abort after 3 attempts, report to human)
  │
  ▼
6. COMMIT   conventional-commit messages, one per logical chunk
  │
  ▼
7. OPEN / UPDATE PR
   PR description contains:
     • work item reference
     • what changed and why
     • guideline acknowledgement
     • out-of-scope notes (human action items)
  │
  ▼
8. REPORT  PR URL + green/amber status to user
```

## When to use this

- A short feature brief has been approved and is ready to implement.
- A `panel-review` or GitHub PR review has produced a set of findings that
  need to be addressed on the same branch (or a fresh one).
- You want the implementation to be provably aligned with the team's security,
  architecture, and documentation standards before a human sees it.

## When NOT to use this

- The work item is still in draft / under discussion. Wait for sign-off.
- The change requires production data migration, manual infra work, or
  third-party coordination — those steps cannot be automated here.
- The scope is so large it would take more than a handful of files to
  implement correctly. Break it into smaller items first.

## Inputs

- **Required:** the work item. One of:
  - A feature brief (free text or a path to a markdown file).
  - A set of review findings (panel-review output, pr-review comment thread,
    or a list of `[BLOCKER]` / `[WARNING]` items).
- **Optional:**
  - `--branch <name>` — override the generated branch name.
  - `--draft` — open the PR as a draft even if checks are green.
  - `--base <branch>` — base branch (default: `main`).

## Output

A pull request on `BarakatAli/zava-storefront` with:

### Branch naming convention

| Input type      | Branch prefix  | Example                          |
|-----------------|----------------|----------------------------------|
| Feature brief   | `feat/`        | `feat/add-product-search-filter` |
| Review findings | `fix/`         | `fix/pr42-security-findings`     |

### Commit convention

One commit per logical unit of work, using conventional commits:

```
feat(scope): <what and why in ≤72 chars>
fix(scope):  <what was wrong and what was done>
docs(scope): <what docs were added or updated>
test(scope): <what test covers the new behaviour>
```

### PR description template

```markdown
## Work item

<link or verbatim excerpt of the feature brief / findings list>

## What changed

<2–4 sentences: what files changed and the reasoning>

## Guideline compliance

- **Security** (`guidelines/security.md`): <one sentence confirming key controls>
- **Architecture** (`guidelines/architecture.md`): <one sentence on coupling / patterns>
- **Documentation** (`guidelines/documentation.md`): <one sentence on docstrings / pages updated>

## Checks

- [x] `npm run lint` — green on commit <sha>
- [x] `npm test`    — green on commit <sha>

## Out of scope (needs human action)

<bulleted list of anything in the work item that was deliberately not
 implemented, with a one-sentence reason each. Empty if nothing was deferred.>

## Dependency justification

<one line per new dependency added, or "no new dependencies">
```

## Process

1. **Read the work item.** If it is a file path, read the file. If it is free
   text, parse it directly.

2. **Load all three guideline files** before writing any code:
   - `guidelines/security.md`
   - `guidelines/architecture.md`
   - `guidelines/documentation.md`

3. **Scope-check.** Split the work item into:
   - **In scope:** changes you can make safely within the stated boundaries.
   - **Out of scope:** anything requiring infra changes, cross-service
     coordination, schema migrations without a migration tool, or that would
     balloon the PR beyond a single reviewable unit. Do not build out-of-scope
     items — note them in the PR description.

4. **Create a branch** from `main` (or `--base` if supplied):
   ```
   git checkout main && git pull
   git checkout -b feat/<slug>
   ```
   The slug is derived from the work item title: lower-kebab-case, max 40 chars.

5. **Implement in-scope changes**, guided by the guideline files:
   - **Security (enforce):** every new HTTP handler needs authN + authZ;
     all DB queries must use parameterized form; no secrets committed; PII
     masked in logs; errors fail-closed.
   - **Architecture (enforce):** follow existing patterns; no new coupling
     between bounded contexts without an explicit reason; keep the change
     testable; favour concrete over abstract for single-caller code.
   - **Documentation (enforce):** all new public functions need TSDoc/JSDoc
     (`@param`, `@returns`, `@example`); any new markdown page follows the
     H1→intro→H2s→See-also structure.

6. **Run checks in a repair loop** (max 3 attempts per check):
   ```
   npm run lint
   ```
   If red: read the lint output, fix each reported issue, re-run. After 3
   consecutive failures, stop and report to the user with the exact output —
   do not open the PR.
   ```
   npm test
   ```
   Same repair loop. A failing test that existed before this branch is **not**
   this skill's responsibility to fix — note it as a pre-existing failure in
   the PR description and continue only if the pre-existing failure is
   documented and not caused by this change.

7. **Commit.** One commit per logical chunk (e.g., one for the feature code,
   one for tests, one for docs updates). Use conventional-commit format.
   Include the `Co-authored-by` trailer:
   ```
   Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>
   ```

8. **Open or update the PR:**
   - If no PR exists for this branch: `gh pr create`.
   - If a PR already exists: `gh pr edit` to update the description.
   - Use the PR description template above.
   - Add labels: `automated`, plus `security` if any security guideline was
     exercised, `documentation` if docs were updated.

9. **Report back** to the user: PR URL, check status (green / amber), and a
   one-paragraph summary of what was built and what was deferred.

## Hard rules

- **Read guidelines first, always.** No code is written before all three
  guideline files have been loaded into context.
- **Scope discipline.** If implementing a work item item would require changes
  the work item didn't ask for (refactors, schema changes, new dependencies
  not justified by the item), stop, note the gap, and do not build it.
- **No PR with red checks.** If lint or tests cannot be made green within 3
  self-repair attempts, the PR is not opened. The user receives the raw
  failure output and a description of what was tried.
- **No drive-by improvements.** Fix only what the work item demands. Other
  observations go in the PR description under "Out of scope."
- **One branch, one work item.** Do not bundle unrelated work items into a
  single branch or PR. If the user supplies multiple unrelated items, ask
  them to split into separate invocations.
- **Conventional commits only.** No "WIP" or "fix stuff" messages.
- **Dependency justification required.** Any new `npm` dependency must have a
  one-line justification in the PR description ("why this lib, why now, what
  alternatives were ruled out"), consistent with the secure-coding-base rule.

## Example invocations

```
> Use build-pr on this feature brief:
>   "Add a /api/products/search endpoint that accepts a `q` query param and
>    returns matching products from the catalogue. Paginate with limit/offset.
>    Results must be authenticated (session cookie). No new dependencies."

> Use build-pr to address the panel-review findings on PR #38:
>   [BLOCKER] Missing authZ on POST /api/orders — add requirePermission check
>   [WARNING] DB query in lib/orders.ts:94 uses string concatenation — parameterize
```

## See also

- `panel-review` skill — generates the findings list that this skill consumes
- `incident-to-pr` skill — purpose-built for postmortem remediations
- `guidelines/security.md` — security rules applied
- `guidelines/architecture.md` — architecture rules applied
- `guidelines/documentation.md` — documentation rules applied
