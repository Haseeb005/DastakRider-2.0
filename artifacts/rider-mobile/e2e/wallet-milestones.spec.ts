import { expect, test } from "@playwright/test";

const scenarios = [
  { name: "before first milestone", slug: "before" },
  { name: "between milestones", slug: "between" },
  { name: "after multiple milestones", slug: "after" },
] as const;

const challengeKinds = ["daily", "weekly"] as const;
const milestoneCounts = { daily: 5, weekly: 5 } as const;

for (const scenario of scenarios) {
  test(`captures readable labels ${scenario.name}`, async ({ page }) => {
    await page.goto(
      `/wallet-milestone-fixture?fixture=wallet-milestones-${scenario.slug}`,
    );
    await expect(page.getByText("Active challenges")).toBeVisible();
    await page.addStyleTag({
      content: ".__expo_fast_refresh { display: none !important; }",
    });

    for (const kind of challengeKinds) {
      const card = page.getByTestId(`wallet-challenge-card-${kind}`);
      const bar = page.getByTestId(`wallet-milestone-bar-${kind}`);
      await expect(card).toBeVisible();
      await expect(bar).toBeVisible();

      const cardBox = await card.boundingBox();
      expect(cardBox, `${kind} challenge card should have bounds`).not.toBeNull();

      const labels = page.locator(`[data-testid^="wallet-milestone-label-${kind}-"]`);
      await expect(labels).toHaveCount(milestoneCounts[kind]);
      const boxes = await labels.evaluateAll((elements) =>
        elements.map((element) => {
          const rect = element.getBoundingClientRect();
          const textElements = element.querySelectorAll(
            `[data-testid^="wallet-milestone-text-"]`,
          );
          return {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
            hasClippedText: Array.from(textElements).some(
              (textElement) =>
                textElement.scrollWidth > textElement.clientWidth + 1 ||
                textElement.scrollHeight > textElement.clientHeight + 1,
            ),
          };
        }),
      );

      expect(boxes.every((box) => box.width > 0 && box.height > 0)).toBe(true);
      expect(
        boxes.every((box) => !box.hasClippedText),
        `${kind} milestone text must not clip`,
      ).toBe(true);
      expect(
        boxes.every(
          (box) =>
            box.x >= cardBox!.x &&
            box.x + box.width <= cardBox!.x + cardBox!.width &&
            box.y >= cardBox!.y &&
            box.y + box.height <= cardBox!.y + cardBox!.height,
        ),
        `${kind} milestone labels must stay inside the challenge card`,
      ).toBe(true);

      for (let index = 1; index < boxes.length; index += 1) {
        const previous = boxes[index - 1];
        const current = boxes[index];
        const overlapsHorizontally =
          current.x < previous.x + previous.width &&
          current.x + current.width > previous.x;
        const overlapsVertically =
          current.y < previous.y + previous.height &&
          current.y + current.height > previous.y;
        expect(
          overlapsHorizontally && overlapsVertically,
          `${kind} milestone labels ${index - 1} and ${index} must not overlap`,
        ).toBe(false);
      }

      await expect(card).toHaveScreenshot(`${scenario.slug}-${kind}.png`, {
        animations: "disabled",
      });
    }
  });
}