import { test, expect } from "@playwright/test";
test("employee → manager → observer: persisted approval, audit and tenant switch", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByRole("button", { name: "Try the demo" }).click();
  await expect(
    page.getByRole("heading", { name: "Requests", exact: true }),
  ).toBeVisible();
  const title = `Team monitors ${info.project.name}`;
  await page.getByRole("button", { name: "New request" }).click();
  await page.getByRole("textbox", { name: "Title", exact: true }).fill(title);
  await page.getByRole("spinbutton", { name: "Amount (EUR)" }).fill("980.50");
  await page
    .getByRole("textbox", { name: "Why is this needed?" })
    .fill("Two monitors for the design team to review layouts.");
  await page.getByRole("button", { name: "Save draft" }).click();
  await page.getByRole("button", { name: "Submit for review" }).click();
  await expect(
    page.getByRole("dialog").getByText("submitted", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close details" }).click();
  await page
    .getByLabel("Explore as")
    .selectOption({ label: "Sam Taylor · manager" });
  await page.getByRole("button", { name: title, exact: true }).click();
  await page
    .getByRole("textbox", { name: "Decision comment" })
    .fill("Approved within the equipment budget.");
  await page.getByRole("button", { name: "Approve request" }).click();
  await expect(
    page.getByRole("dialog").getByText("approved", { exact: true }),
  ).toBeVisible();
  if (process.env.EXPECT_REPORT === "1") {
    await expect(async () => {
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "Refresh", exact: false })
        .click();
      await expect(
        page.getByText("Report ready. One persisted result."),
      ).toBeVisible();
    }).toPass({ timeout: 20000 });
  }
  await page.getByRole("button", { name: "Close details" }).click();
  await page
    .getByLabel("Explore as")
    .selectOption({ label: "Jordan Lee · observer" });
  await expect(
    page.getByRole("button", { name: "New request" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: title, exact: true }).click();
  await expect(
    page.getByText("request approved", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("request submitted", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("request created", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: `evidence/${info.project.name}-audit.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "Close details" }).click();
  await page.reload();
  await expect(
    page.getByRole("button", { name: title, exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: `evidence/${info.project.name}-register.png`,
    fullPage: true,
  });
  await page
    .getByLabel("Organization", { exact: true })
    .selectOption({ label: "Contoso Labs" });
  await expect(
    page.getByRole("button", { name: title, exact: true }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});
