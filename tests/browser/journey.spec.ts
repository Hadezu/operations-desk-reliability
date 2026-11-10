import { test, expect } from "@playwright/test";
test("employee → manager → observer: persisted approval, audit and tenant switch", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(
    page.getByRole("link", { name: "Explore the code" }),
  ).toHaveAttribute(
    "href",
    "https://github.com/Hadezu/operations-desk-reliability",
  );
  await expect(
    page.getByRole("list", { name: "Project technologies" }),
  ).toContainText("PostgreSQL / Prisma");
  await page.getByRole("button", { name: "Try the demo" }).click();
  await expect(
    page.getByRole("heading", { name: "Requests", exact: true }),
  ).toBeVisible();
  const title = `Team monitors ${info.project.name}`;
  await page.getByRole("button", { name: "New request" }).click();
  const dialog = page.getByRole("dialog");
  const draftTitle = dialog.getByRole("textbox", {
    name: "Title",
    exact: true,
  });
  const description = dialog.getByRole("textbox", {
    name: "Why is this needed?",
  });
  const saveDraft = dialog.getByRole("button", { name: "Save draft" });
  const createAttempts: string[] = [];
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      new URL(request.url()).pathname === "/api/requests"
    )
      createAttempts.push(request.url());
  });
  await draftTitle.fill("  IT  ");
  await page.getByRole("spinbutton", { name: "Amount (EUR)" }).fill("980.50");
  await description.fill("Two monitors for the design team to review layouts.");
  await saveDraft.click();
  await expect(dialog.getByRole("alert")).toContainText(
    "Enter a title with at least 3 characters",
  );
  await expect(draftTitle).toBeFocused();
  expect(createAttempts).toHaveLength(0);
  await draftTitle.fill(`  ${title}  `);
  await description.fill("  QA  ");
  await saveDraft.click();
  await expect(dialog.getByRole("alert")).toContainText(
    "Explain why this is needed in at least 5 characters",
  );
  await expect(description).toBeFocused();
  expect(createAttempts).toHaveLength(0);
  await description.fill(
    "  Two monitors for the design team to review layouts.  ",
  );
  const [saved] = await Promise.all([
    page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === "/api/requests",
    ),
    saveDraft.click(),
  ]);
  expect(saved.ok()).toBe(true);
  expect(saved.request().postDataJSON()).toMatchObject({
    title,
    description: "Two monitors for the design team to review layouts.",
    amountCents: 98050,
  });
  expect(await saved.json()).toMatchObject({
    title,
    status: "DRAFT",
    version: 1,
  });
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
  } else {
    await expect(
      page.getByRole("heading", { name: "Approval recorded", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Inspect worker recovery evidence" }),
    ).toHaveAttribute("href", "/proof/#worker-recovery");
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
  const activity = page.getByRole("dialog").getByRole("listitem");
  await expect(activity.filter({ hasText: "request created" })).toContainText(
    "Alex Morgan · employee",
  );
  await expect(activity.filter({ hasText: "request submitted" })).toContainText(
    "Alex Morgan · employee",
  );
  await expect(activity.filter({ hasText: "request approved" })).toContainText(
    "Sam Taylor · manager",
  );
  if (process.env.EXPECT_REPORT === "1")
    await expect(
      activity.filter({ hasText: "report completed" }),
    ).toContainText("System · automated action");
  await page.screenshot({
    path: `evidence/${info.project.name}-audit.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "Close details" }).click();
  await page.reload();
  await expect(
    page.getByRole("button", { name: title, exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: title, exact: true }).click();
  await expect(dialog.getByText("approved", { exact: true })).toBeVisible();
  await expect(
    dialog.getByText("request approved", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close details" }).click();
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
  await page.goto("/proof/");
  await expect(
    page.getByRole("heading", { name: "Six guarantees. Open to inspection." }),
  ).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(6);
  await expect(
    page.getByRole("link", { name: "GitHub repository" }),
  ).toHaveAttribute(
    "href",
    "https://github.com/Hadezu/operations-desk-reliability",
  );
  const recovery = page.getByRole("article", {
    name: "Worker recovery",
    exact: true,
  });
  await recovery.locator("summary").click();
  await expect(recovery.locator("details")).toHaveAttribute("open", "");
  // The detailed evidence must remain readable at the mobile viewport, too.
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `evidence/${info.project.name}-proof.png`,
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
