import { describe, it, expect } from "vitest";
import { lookupPromo } from "../lib/promo";

describe("lookupPromo", () => {
  it("finds WELCOME10 by exact code", () => {
    const promo = lookupPromo("WELCOME10");
    expect(promo).not.toBeNull();
    expect(promo!.code).toBe("WELCOME10");
    expect(promo!.discountPercent).toBe(10);
    expect(promo!.minimumSubtotalCents).toBeUndefined();
  });

  it("is case-insensitive", () => {
    expect(lookupPromo("welcome10")).not.toBeNull();
    expect(lookupPromo("Welcome10")).not.toBeNull();
  });

  it("finds VIP25 and exposes the minimum subtotal", () => {
    const promo = lookupPromo("VIP25");
    expect(promo).not.toBeNull();
    expect(promo!.discountPercent).toBe(25);
    expect(promo!.minimumSubtotalCents).toBe(10_000);
  });

  it("returns null for an unknown code", () => {
    expect(lookupPromo("BOGUS99")).toBeNull();
  });

  it("returns null for an empty string", () => {
    expect(lookupPromo("")).toBeNull();
  });

  it("returns null for a whitespace-only string", () => {
    expect(lookupPromo("   ")).toBeNull();
  });
});
