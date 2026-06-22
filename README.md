# Zava Storefront

> **Part of the [Zava Workshop Kit](https://github.com/hackathon-brown-eagle-55/zava-workshop-kit)** — deploy this repo + the rest of the workshop bundle into your own org with one script.

Customer-facing storefront for Zava (fictional e-commerce reference app, used in the [Zava workshop bundle](https://github.com/hackathon-brown-eagle-55/zava-workshop-kit)).

## Stack

- **Frontend:** Next.js 14 (App Router) + React 18 + TypeScript
- **API:** Next.js Route Handlers
- **Database:** PostgreSQL 16
- **Container:** Distroless Node 20
- **Cloud:** Azure Container Apps + Azure Database for PostgreSQL Flexible Server
- **IaC:** Bicep
- **CI/CD:** GitHub Actions

## Agentic SDLC config

This repo pins **`hackathon-brown-eagle-55/zava-agent-config@^1.0.0`** via [`apm.yml`](apm.yml). That gives every contributor:

- 🛡️ The Zava `secure-coding-base`, `ci-cd-golden-paths`, `docs-style-guide` instructions
- 🤖 The `meeting-to-issue`, `panel-review`, `incident-to-pr` skills
- 👤 The `architect` and `security` personas
- 🪝 The `pr-review-gate` pre-push hook
- ✅ The `apm-audit` CI workflow as a required check

Run `apm install` after cloning to materialize them into your harness.

## API reference

### `POST /api/cart/promo`

Applies a percentage-discount promo code to a cart and returns the full set of
totals.  This is a public endpoint — no authentication required.

**Request body**

```json
{
  "items": [{ "productId": "abc", "quantity": 2, "unitPriceCents": 1500 }],
  "promoCode": "WELCOME10",
  "region": "GB"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `items` | `CartItem[]` | 1–50 items.  Each item needs `productId`, `quantity` (1–99), and `unitPriceCents` (≥ 0). |
| `promoCode` | `string` | Case-insensitive promo code (max 50 chars). |
| `region` | `string` | Tax jurisdiction — `"GB"`, `"DE"`, `"US-CA"`, `"US-OR"`, or any other code (falls back to 10% tax). |

**Responses**

| Status | Body | Meaning |
|--------|------|---------|
| 200 | `{ subtotalCents, discountCents, taxCents, totalCents, promoCode, discountPercent }` | Totals computed successfully. |
| 400 | `{ error: "invalid_input", details: … }` | Request body failed schema validation. |
| 422 | `{ error: "promo_code_not_found" }` | Promo code is not recognised. |
| 422 | `{ error: "promo_minimum_not_met", minimumSubtotalCents: … }` | Cart subtotal is below the code's minimum. |

**Active promo codes**

| Code | Discount | Minimum cart value |
|------|----------|--------------------|
| `WELCOME10` | 10% | None |
| `VIP25` | 25% | £100 (10 000 pence) |

## Local dev

```bash
apm install              # materialize agentic config
pnpm install
pnpm dev
```

## Run audit locally

```bash
apm audit                # warn-mode
```

## See also

- [`zava-agent-config`](https://github.com/hackathon-brown-eagle-55/zava-agent-config) — the central agentic primitives package
- [PLATFORM.md](https://github.com/hackathon-brown-eagle-55/agentic-sdlc-ref/blob/main/PLATFORM.md) — platform reference
- [Lloyds Phase 1 delivery plan](https://github.com/hackathon-brown-eagle-55/agentic-sdlc-ref/blob/main/delivery/lloyds-ph1-delivery-plan.md)

## Workshop usage

This repo is the **canonical target** for the [`zava-skills-workshop-template`](https://github.com/hackathon-brown-eagle-55/zava-skills-workshop-template) workshop. The workshop tracks reference these files:

- `lib/cart.ts`, `lib/orders.ts`, `lib/search.ts` — Track 1 (test-improver) and Track 2 (docs-generator) targets. 5 / 5 / 2 exported functions, intentionally undocumented + intentionally under-tested.
- `tests/*.test.ts` — vitest specs (`npm test`) — the oracle for Track 1's "must still pass" gate.
- `security-fixtures/` — Track 3 (dependency-auditor) target. Deliberately vulnerable deps (lodash 4.17.4 / axios 0.21.0 / minimist 0.0.8), isolated from this app via the `preinstall` guard in `scripts/guard-deps.js`.

If you're following the workshop, clone this repo into your generated workshop repo and run `npm install --prefix zava-storefront`. Track docs do the rest.
