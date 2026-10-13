import { expect, test } from "@playwright/test";
import {
  CLOCK_START,
  installRiderApiMocks,
  riderOrder,
  signIntoExpoWeb,
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
    nextStop: "NEXT STOP · RESTAURANT PICKUP",
  },
  {
    name: "one picked-up order",
    orders: [riderOrder("order-1", "Rider Picked Up")],
    count: "1 of 2 live orders",
    guidance: "You may see another order after idle riders' 30-second priority.",
    nextStop: "NEXT STOP · CUSTOMER DROP-OFF",
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
    nextStop: "NEXT STOP · RESTAURANT PICKUP",
    secondNextStop: "NEXT STOP · CUSTOMER DROP-OFF",
  },
] as const;

for (const scenario of capacityCases) {
  test(`shows correct capacity and next-stop guidance for ${scenario.name}`, async ({
    page,
  }) => {
    await signIntoExpoWeb(page);
    await installRiderApiMocks(page, [...scenario.orders]);
    await page.goto("/");
    await expect(page.getByText("Fixture Rider")).toBeVisible();
    await page.getByText("Active", { exact: true }).last().click();

    await expect(
      page.getByText(scenario.count, { exact: true }).last(),
    ).toBeVisible();
    await expect(
      page.getByText(scenario.guidance, { exact: true }).last(),
    ).toBeVisible();

    if ("nextStop" in scenario) {
      await expect(page.getByText(scenario.nextStop, { exact: true })).toBeVisible();
    }
    if ("secondNextStop" in scenario) {
      await expect(
        page.getByText(scenario.secondNextStop, { exact: true }),
      ).toBeVisible();
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
  await signIntoExpoWeb(page);
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
    page.getByText("Idle riders’ priority", { exact: true }),
  ).toHaveCount(0);
});

test("shows unlimited live-order capacity for an exempt rider", async ({ page }) => {
  await signIntoExpoWeb(page);
  await installRiderApiMocks(
    page,
    [
      riderOrder("order-1", "Rider Accepted"),
      riderOrder("order-2", "Rider Accepted"),
      riderOrder("order-3", "Rider Picked Up"),
    ],
    false,
    true,
  );
  await page.goto("/");
  await page.getByText("Active", { exact: true }).last().click();

  await expect(page.getByText("3 live orders", { exact: true }).last()).toBeVisible();
  await expect(page.getByText("No order cap", { exact: true }).last()).toBeVisible();
  await expect(
    page.getByText(
      "You can accept more orders while these are active. Idle riders still get the first 30 seconds to accept new offers.",
      { exact: true },
    ).last(),
  ).toBeVisible();
});

test("opens the selected customer's chat from its active order", async ({
  page,
}) => {
  const orders = [
    riderOrder("order-1", "Rider Accepted"),
    riderOrder("order-2", "Rider Picked Up"),
  ];
  await signIntoExpoWeb(page);
  await installRiderApiMocks(page, orders);
  await page.goto("/");
  await page.getByText("Active", { exact: true }).last().click();
  await page.getByText("Chat with Customer", { exact: true }).last().click();

  await expect(page).toHaveURL(/\/chat\/order-2/);
  await expect(
    page.getByText("Test Customer 2", { exact: true }).last(),
  ).toBeVisible();
  await expect(page.getByText("#TEST-2", { exact: true }).last()).toBeVisible();
});

test("routes restaurant and customer navigation and call actions to each next stop", async ({
  page,
}) => {
  const orders = [
    riderOrder("order-1", "Rider Accepted"),
    riderOrder("order-2", "Rider Picked Up"),
  ];
  await page.addInitScript(() => {
    (window as typeof window & { __openedUrls?: string[] }).__openedUrls = [];
    window.open = ((url?: string | URL) => {
      (window as typeof window & { __openedUrls?: string[] }).__openedUrls?.push(
        String(url ?? ""),
      );
      return null;
    }) as typeof window.open;
  });
  await signIntoExpoWeb(page);
  await installRiderApiMocks(page, orders);
  await page.goto("/");
  await page.getByText("Active", { exact: true }).last().click();

  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Page.enable");
  let requestedNavigation: string | null = null;
  cdp.on("Page.frameRequestedNavigation", (event) => {
    requestedNavigation = event.url;
  });

  const mapActions = [
    {
      label: "Navigate to restaurant",
      destination:
        "https://www.google.com/maps/search/?api=1&query=31.5304%2C74.3687",
    },
    {
      label: "Navigate to customer",
      destination:
        "https://www.google.com/maps/search/?api=1&query=31.4704%2C74.3787",
    },
  ];

  for (const action of mapActions) {
    await page.getByLabel(action.label).click();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as typeof window & { __openedUrls?: string[] })
              .__openedUrls?.at(-1) ?? "",
        ),
      )
      .toBe(action.destination);
  }

  const callActions = [
    { label: "Call restaurant", destination: "tel:+923001112221" },
    { label: "Call customer", destination: "tel:+923009998882" },
  ];
  for (const action of callActions) {
    requestedNavigation = null;
    await page.getByLabel(action.label).click();
    await expect.poll(() => requestedNavigation).toBe(action.destination);
  }

  await page.getByText("Chat with Customer", { exact: true }).last().click();
  await expect(page).toHaveURL(/\/chat\/order-2/);
  await expect(
    page.getByText("Test Customer 2", { exact: true }).last(),
  ).toBeVisible();
  await expect(page.getByText("#TEST-2", { exact: true }).last()).toBeVisible();
});
