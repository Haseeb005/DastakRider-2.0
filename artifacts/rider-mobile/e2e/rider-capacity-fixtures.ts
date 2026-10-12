import type { Page } from "@playwright/test";

export const CLOCK_START = "2025-01-01T00:00:00.000Z";

export type OrderStatus = "Rider Accepted" | "Rider Picked Up";

export function riderOrder(id: string, status: OrderStatus) {
  const index = id.endsWith("2") ? 2 : 1;
  const restaurantLatitude = index === 1 ? 31.5304 : 31.5404;
  const restaurantLongitude = index === 1 ? 74.3687 : 74.3787;
  const customerLatitude = index === 1 ? 31.4604 : 31.4704;
  const customerLongitude = index === 1 ? 74.3687 : 74.3787;
  return {
    id,
    orderNum: `TEST-${index}`,
    status,
    restaurantName: `Test Restaurant ${index}`,
    martAddress: `${index} Test Restaurant Road, Lahore`,
    martLatitude: restaurantLatitude,
    martLongitude: restaurantLongitude,
    martPhone: `+92300111222${index}`,
    address: `${index} Test Customer Street, Lahore`,
    latitude: customerLatitude,
    longitude: customerLongitude,
    phone: `+92300999888${index}`,
    userName: `Test Customer ${index}`,
    total: 1000,
    deliveryFee: 100,
    subtotal: 900,
    createdAt: CLOCK_START,
  };
}

export async function installRiderApiMocks(
  page: Page,
  activeOrders: ReturnType<typeof riderOrder>[],
  withTimedOffer = false,
) {
  await page.route("**/api/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === "/api/rider/me") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "fixture-rider",
          name: "Fixture Rider",
          phone: "+923001234567",
          isOnline: true,
          riderZones: ["Lahore"],
          tillNoonFare: 100,
        }),
      });
      return;
    }

    if (pathname === "/api/rider/orders/active") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(activeOrders),
      });
      return;
    }

    if (pathname === "/api/rider/orders/available") {
      const availableOrders = withTimedOffer
        ? [
            {
              id: "available-fixture",
              restaurantName: "Timed Offer Restaurant",
              martAddress: "10 Priority Road, Lahore",
              martLatitude: 31.5204,
              martLongitude: 74.3587,
              martPhone: "+923001234000",
              deliveryAddress: "11 Customer Road, Lahore",
              deliveryLatitude: 31.4504,
              deliveryLongitude: 74.3587,
              riderOfferStartedAt: CLOCK_START,
              status: "Admin Accepted",
              total: 500,
              deliveryFee: 100,
              subtotal: 400,
              createdAt: CLOCK_START,
            },
          ]
        : [];
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(availableOrders),
      });
      return;
    }

    if (pathname.endsWith("/chat") || pathname.endsWith("/chat/read")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(pathname.endsWith("/chat/read") ? { ok: true } : []),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true }),
    });
  });
}

export async function signIntoExpoWeb(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("dastak_rider_token", "fixture-token");
  });
}
