// PUBLIC ROUTE — applies a promo code to a cart and returns the discounted
// totals.  No user data is read or written; authentication is not required.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { cartItemSchema, totalize } from "@/lib/cart";
import { lookupPromo } from "@/lib/promo";

const BodySchema = z.object({
  /** Cart contents to price. Must contain at least one item. */
  items: z.array(cartItemSchema).min(1).max(50),
  /** Promo code to apply (case-insensitive). */
  promoCode: z.string().min(1).max(50),
  /**
   * ISO region / tax jurisdiction code, e.g. `"GB"`, `"DE"`, `"US-CA"`.
   * Governs the tax rate applied after the discount.
   */
  region: z.string().min(2).max(8),
});

/**
 * POST /api/cart/promo
 *
 * Applies a percentage-discount promo code to a cart and returns the full
 * set of totals (subtotal, discount, tax, total).
 *
 * Returns 400 when the request body fails schema validation.
 * Returns 422 when the promo code is unrecognised or the cart does not meet
 * the code's minimum-subtotal requirement.
 */
export async function POST(req: NextRequest) {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_input", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { items, promoCode, region } = parsed.data;
  const upperCode = promoCode.toUpperCase().trim();

  const promo = lookupPromo(upperCode);
  if (!promo) {
    return NextResponse.json({ error: "promo_code_not_found" }, { status: 422 });
  }

  const subtotalCents = items.reduce(
    (sum, item) => sum + item.unitPriceCents * item.quantity,
    0,
  );

  if (
    promo.minimumSubtotalCents !== undefined &&
    subtotalCents < promo.minimumSubtotalCents
  ) {
    return NextResponse.json(
      {
        error: "promo_minimum_not_met",
        minimumSubtotalCents: promo.minimumSubtotalCents,
      },
      { status: 422 },
    );
  }

  const totals = totalize(items, upperCode, region);

  return NextResponse.json({
    ...totals,
    promoCode: upperCode,
    discountPercent: promo.discountPercent,
  });
}
