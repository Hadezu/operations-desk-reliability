import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
for (const lang of ["de", "pl"] as const)
  test(`Association ${lang}: complete synthetic workflow and accessibility`, async ({
    page,
  }, info) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/association/");
    await page.getByRole("combobox").first().selectOption(lang);
    const de = lang === "de";
    await page
      .getByRole("button", { name: de ? "Demo starten" : "Uruchom demo" })
      .click();
    await expect(
      page.getByRole("button", {
        name: de ? "Import prüfen" : "Sprawdź import",
      }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: de ? "Beispiel laden" : "Wczytaj przykład" })
      .click();
    await page
      .getByRole("button", { name: de ? "Import prüfen" : "Sprawdź import" })
      .click();
    await expect(
      page.getByText(de ? "Doppelte Identität" : "Powielona tożsamość", {
        exact: true,
      }),
    ).toBeVisible();
    for (const n of [2, 3, 4])
      await page
        .getByRole("checkbox", {
          name: `${de ? "Auswählen" : "Wybierz"} ${n}`,
          exact: true,
        })
        .check();
    await page.getByRole("button", { name: /\(3\)/ }).click();
    await expect(
      page.getByText("anna@example.invalid", { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("status")).toHaveText(
      de ? "Vorgang gespeichert." : "Operacja zapisana.",
    );
    await page
      .getByRole("button", {
        name: de ? "02 Beiträge erstellen" : "02 Nalicz składki",
      })
      .click();
    await page
      .getByRole("button", {
        name: de ? "Beiträge erstellen" : "Nalicz składki",
        exact: true,
      })
      .click();
    await expect(
      page.getByRole("cell", { name: "M001/2026-10", exact: true }),
    ).toBeVisible();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page
      .getByRole("button", {
        name: de ? "03 Zahlungen abgleichen" : "03 Uzgodnij płatności",
      })
      .click();
    await page
      .getByRole("button", { name: de ? "Beispiel laden" : "Wczytaj przykład" })
      .click();
    await page
      .getByRole("button", {
        name: de ? "Bank-CSV importieren" : "Importuj bankowy CSV",
      })
      .click();
    await expect(page.getByText("BANK004 ·")).toBeVisible();
    await page
      .getByRole("button", {
        name: de ? "Sicher erneut abgleichen" : "Ponów bezpieczne uzgodnienie",
      })
      .click();
    await expect(
      page.getByText("BANK001 → M001/2026-10", { exact: true }),
    ).toBeVisible();
    const issue = page.locator("article").filter({ hasText: "BANK002" });
    await issue.getByRole("combobox").selectOption("M003/2026-10");
    await issue.getByRole("button").click();
    await expect(
      page.getByText("BANK002 → M003/2026-10", { exact: true }),
    ).toBeVisible();
    const exportResponse = await page.request.get("/api/association/export");
    expect(exportResponse.status()).toBe(200);
    expect(await exportResponse.text()).toContain("BANK001,paid");
    await page.screenshot({
      path: `evidence/association-${lang}-${info.project.name}-payments.png`,
      fullPage: true,
    });
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page
      .getByRole("button", {
        name: de ? "04 Dokumente & Verlauf" : "04 Dokumenty i historia",
      })
      .click();
    await page
      .getByRole("button", {
        name: de ? "Vorschau erstellen" : "Utwórz podgląd",
      })
      .click();
    await expect(page.locator("pre").first()).toContainText(
      de ? "Keine E-Mail versendet" : "Nie wysłano e-maila",
    );
    await page.locator(".assoc-controls select").selectOption("OBSERVER");
    await expect(
      page.getByRole("button", {
        name: de ? "Vorschau erstellen" : "Utwórz podgląd",
      }),
    ).toBeDisabled();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({
      path: `evidence/association-${lang}-${info.project.name}-history.png`,
      fullPage: true,
    });
    expect(errors).toEqual([]);
  });
