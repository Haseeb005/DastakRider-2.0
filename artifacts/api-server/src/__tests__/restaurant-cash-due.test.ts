import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { calculatePrepaidRestaurantCashAmount } from "../lib/restaurantCashDue";

describe("prepaid restaurant cash due", () => {
  it("sums positive restaurant actualPrice values by count and adds VAT", () => {
    assert.equal(
      calculatePrepaidRestaurantCashAmount({
        billingMode: "prepaid",
        shopType: "restaurant",
        vatAmount: 15,
        products: [
          { actualPrice: 100, count: 2 },
          { actualPrice: "50.5", count: "3" },
          { actualPrice: 0, price: 900, count: 1 },
          { actualPrice: -10, count: 1 },
        ],
      }),
      366.5,
    );
  });

  it("returns no restaurant amount for other billing modes or shop types", () => {
    const order = {
      billingMode: "prepaid",
      shopType: "mart",
      vatAmount: 10,
      products: [{ actualPrice: 100, count: 1 }],
    };
    assert.equal(calculatePrepaidRestaurantCashAmount(order), null);
    assert.equal(
      calculatePrepaidRestaurantCashAmount({ ...order, shopType: "restaurant", billingMode: "postpaid" }),
      null,
    );
  });

  it("returns no amount when there are no positive actualPrice values", () => {
    assert.equal(
      calculatePrepaidRestaurantCashAmount({
        billingMode: "prepaid",
        shopType: "restaurant",
        vatAmount: 20,
        products: [{ actualPrice: 0, price: 500, count: 1 }],
      }),
      null,
    );
  });

  it("treats missing or invalid counts as one and ignores negative VAT", () => {
    assert.equal(
      calculatePrepaidRestaurantCashAmount({
        billingMode: "prepaid",
        shopType: "restaurant",
        vatAmount: -12,
        products: [
          { actualPrice: 40 },
          { actualPrice: 60, count: 0 },
        ],
      }),
      100,
    );
  });
});
