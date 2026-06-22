/** A recognised promotional code and its discount terms. */
export interface PromoCode {
  /** Canonical uppercase code string. */
  code: string;
  /** Percentage discount applied to the cart subtotal (0–100). */
  discountPercent: number;
  /**
   * Minimum cart subtotal in pence (GBP) the customer must reach before
   * the discount applies.  Absent means no minimum.
   */
  minimumSubtotalCents?: number;
}

/**
 * Registry of active promo codes.
 *
 * NOTE: This is a hard-coded catalogue intentionally scoped to this PR.
 * Migrating to a DB-backed `promo_codes` table (with expiry, usage limits,
 * and an admin CRUD API) is out of scope here — tracked as a follow-up.
 */
const CATALOGUE: readonly PromoCode[] = [
  { code: 'WELCOME10', discountPercent: 10 },
  { code: 'VIP25', discountPercent: 25, minimumSubtotalCents: 10_000 },
];

/**
 * Looks up a promo code in the catalogue.
 *
 * @param code - The promo code string (case-insensitive).
 * @returns The matched {@link PromoCode}, or `null` if unrecognised.
 */
export function lookupPromo(code: string): PromoCode | null {
  const upper = code.toUpperCase().trim();
  return CATALOGUE.find((p) => p.code === upper) ?? null;
}
