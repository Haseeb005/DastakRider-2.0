import { expect, test } from "@playwright/test";
import {
  CLOCK_START,
  installRiderApiMocks,
  riderOrder,
} from "./rider-capacity-fixtures";

const capacityCases = [
  {
    name: "zero live orders",
    orders: [],
    count: "0 of 2 live orders",
    guidance: "New orders are offered to riders with no active deliveries first.",
  },
  {
    name: "one accepted order",
    orders: [riderOrder("order-1", "Rider Accepted")],
    count: "1 of 2 live orders",
    guidance: "Pick up your accepted order before accepting another.",
    nextStop: "Restaurant pickup",
  },
  {
    name: "one picked-up order",
    orders: [riderOrder("order-1", "Rider Picked Up")],
    count: "1 of 2 live orders",
    guidance: "You may see another order after idle riders' 30-second priority.",
    nextStop: "Customer drop-off",
  },
  {
    name: "two live orders, including one accepted",
    orders: [
      riderOrder("order-1", "Rider Accepted"),
      riderOrder("order-2", "Rider Picked Up"),
    ],
    count: "2 of 2 live orders",
    guidance:
      "At capacity. Pick up the accepted order, then complete a delivery before taking another.",
    nextStops: ["Restaurant pickup", "Customer drop-off"],
  },
] as const;

for (const scenario of capacityCases) {
  test(`shows correct capacity and next-stop guidance for ${scenario.name}`, async ({
    page,
  }) => {
    await installRiderApiMocks(page, [...scenario.orders]);
    await page.goto("/");
    await expect(page.getByText("Fixture Rider")).toBeVisible();
    await page.locator("nav").getByRole("button", { name: /Active/ }).click();

    await expect(page.getByText(scenario.count, { exact: true })).toBeVisible();
    await expect(page.getByText(scenario.guidance, { exact: true })).toBeVisible();

    if ("nextStop" in scenario) {
      await expect(page.getByText(scenario.nextStop, { exact: true })).toBeVisible();
    }
    if ("nextStops" in scenario) {
      for (const nextStop of scenario.nextStops) {
        await expect(page.getByText(nextStop, { exact: true })).toBeVisible();
      }
    }
    if (scenario.orders.length === 0) {
      await expect(
        page.getByText("No active deliveries", { exact: true }).last(),
      ).toBeVisible();
    }
  });
}

test("counts down the priority window and hides it at 30 seconds", async ({
  page,
}) => {
  await page.clock.install({ time: new Date(CLOCK_START) });
  await installRiderApiMocks(page, [], true);
  await page.goto("/");
  await expect(page.getByText("Timed Offer Restaurant")).toBeVisible();
  const timer = page.getByText(/^0:\d{2}$/).last();
  await expect(timer).toBeVisible();
  const shownTime = await timer.textContent();
  const secondsRemaining = Number(shownTime?.split(":")[1]);
  expect(secondsRemaining).toBeGreaterThan(1);

  await page.clock.runFor((secondsRemaining - 1) * 1_000);
  await expect(timer).toHaveText("0:01");

  await page.clock.runFor(1_000);
  await expect(
    page.getByText("Idle riders’ priority ends in", { exact: true }),
  ).toHaveCount(0);
});

test("shows the correct call and map destinations for both next stops", async ({
  page,
}) => {
  const orders = [
    riderOrder("order-1", "Rider Accepted"),
    riderOrder("order-2", "Rider Picked Up"),
  ];
  await installRiderApiMocks(page, orders);
  await page.goto("/");
  await page.locator("nav").getByRole("button", { name: /Active/ }).click();

  const navigateLinks = page.getByRole("link", { name: "Navigate" });
  await expect(navigateLinks).toHaveCount(2);
  await expect(navigateLinks.nth(0)).toHaveAttribute(
    "href",
    "https://www.google.com/maps/search/?api=1&query=31.5304%2C74.3687",
  );
  await expect(navigateLinks.nth(1)).toHaveAttribute(
    "href",
    "https://www.google.com/maps/search/?api=1&query=31.4704%2C74.3787",
  );

  await expect(page.getByRole("link", { name: "Call restaurant" })).toHaveAttribute(
    "href",
    "tel:+923001112221",
  );
  await expect(page.getByRole("link", { name: "Call customer" })).toHaveAttribute(
    "href",
    "tel:+923009998882",
  );

  await page.getByRole("button", { name: "Chat with Customer" }).last().click();
  await expect(page.getByText("Test Customer 2", { exact: true }).last()).toBeVisible();
  await expect(page.getByText("#TEST-2", { exact: true }).last()).toBeVisible();
});
