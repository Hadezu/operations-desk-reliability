import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
for (const lang of ["de", "pl"] as const)
  test(`Booking ${lang}: hold, payment replay, cancel and refund`, async ({
    page,
  }, info) => {
    const de = lang === "de";
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/booking/");
    await page.getByRole("combobox").first().selectOption(lang);
    await page
      .getByRole("button", { name: de ? "Demo starten" : "Uruchom demo" })
      .click();
    await page
      .getByRole("button", {
        name: de ? "Reservieren · Tourenrad" : "Rezerwuj · Rower turystyczny",
      })
      .click();
    await expect(
      page.getByRole("button", {
        name: de ? "Reservieren · Tourenrad" : "Rezerwuj · Rower turystyczny",
      }),
    ).toBeDisabled();
    await page
      .getByRole("button", {
        name: de ? "Zahlung erfolgreich simulieren" : "Symuluj udaną płatność",
      })
      .click();
    await expect(page.locator(".assoc-ok")).toHaveText(
      de ? "Bestätigt" : "Potwierdzone",
    );
    await page
      .getByRole("button", {
        name: de
          ? "Letztes Ereignis wiederholen"
          : "Powtórz ostatnie zdarzenie",
      })
      .click();
    await expect(page.locator("tbody tr")).toHaveCount(1);
    await page
      .getByRole("button", { name: de ? "Stornieren" : "Anuluj", exact: true })
      .click();
    await expect(page.locator(".assoc-ok")).toHaveText(
      de ? "Erstattung offen" : "Zwrot oczekujący",
    );
    await page
      .getByRole("button", {
        name: de ? "Erstattung simulieren" : "Symuluj zwrot",
      })
      .click();
    await expect(page.locator(".assoc-ok")).toHaveText(
      de ? "Erstattet" : "Zwrócone",
    );
    await expect(
      page.getByRole("button", {
        name: de ? "Reservieren · Tourenrad" : "Rezerwuj · Rower turystyczny",
      }),
    ).toBeEnabled();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `evidence/booking-${lang}-${info.project.name}.png`,
      fullPage: true,
    });
    expect(errors).toEqual([]);
  });
