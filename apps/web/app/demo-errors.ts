const messages: Record<string, [string, string]> = {
  RESOURCE_UNAVAILABLE: [
    "Die Ressource ist in diesem Zeitraum bereits reserviert. Wählen Sie einen anderen Zeitraum.",
    "Zasób jest już zarezerwowany w tym terminie. Wybierz inny przedział.",
  ],
  INVALID_INTERVAL: [
    "Wählen Sie einen zukünftigen Zeitraum von höchstens 24 Stunden.",
    "Wybierz przyszły przedział trwający najwyżej 24 godziny.",
  ],
  STALE_PLAN: [
    "Mitgliederdaten wurden geändert. Erstellen Sie einen neuen Importvorschau.",
    "Dane członków zmieniły się. Utwórz nowy podgląd importu.",
  ],
  CSV_FORMAT: [
    "CSV-Format nicht unterstützt. Verwenden Sie die Kopfzeile des Beispiels, ohne Anführungszeichen, mit maximal 50 Zeilen.",
    "Nieobsługiwany format CSV. Użyj nagłówka z przykładu, bez cudzysłowów, najwyżej 50 wierszy.",
  ],
  INVALID_SELECTION: [
    "Wählen Sie nur gültige, konfliktfreie Zeilen.",
    "Wybierz wyłącznie poprawne wiersze bez konfliktów.",
  ],
  PAYMENT_CONFLICT: [
    "Diese Zahlungs-ID existiert mit anderen Daten. Der gesamte Import wurde abgelehnt.",
    "Ten identyfikator płatności istnieje z innymi danymi. Cały import został odrzucony.",
  ],
  ALLOCATION_CONFLICT: [
    "Betrag oder Zuordnung stimmt nicht. Aktualisieren Sie die offenen Zahlungen.",
    "Kwota lub przypisanie nie pasuje. Odśwież otwarte płatności.",
  ],
  FORBIDDEN: [
    "Diese Rolle darf die Aktion nicht ausführen.",
    "Ta rola nie ma uprawnień do tej operacji.",
  ],
  RATE_LIMITED: [
    "Zu viele Anfragen. Warten Sie eine Minute und versuchen Sie es erneut.",
    "Zbyt wiele żądań. Odczekaj minutę i spróbuj ponownie.",
  ],
  SESSION_EXPIRED: [
    "Die Demositzung ist abgelaufen. Laden Sie die Seite neu und starten Sie erneut.",
    "Sesja demonstracyjna wygasła. Odśwież stronę i uruchom demo ponownie.",
  ],
  DEMO_LIMIT: [
    "Das Limit dieses Demobereichs ist erreicht.",
    "Osiągnięto limit tej przestrzeni demonstracyjnej.",
  ],
};
export function demoError(
  error: unknown,
  language: "de" | "pl",
  fallback: string,
) {
  return (
    messages[error instanceof Error ? error.message : ""]?.[
      language === "de" ? 0 : 1
    ] ?? fallback
  );
}
