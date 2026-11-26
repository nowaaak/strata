import { de as n, en as nEn } from "../plural";

export const de = {
    run: "Ausführen",
    runHint: "Statement am Cursor oder Auswahl (Strg+Enter)",
    all: "Alles",
    allHint: "Ganzes Skript ausführen (Strg+⇧+Enter)",
    cancel: "Abbrechen",
    database: "Datenbank",
    noDatabase: "Keine Datenbank",
    readOnly: "Nur lesen",
    confirmBadge: "Änderungen werden bestätigt",
    startFailed: "Abfrage konnte nicht gestartet werden",
    format: "Formatieren",
    formatHint: "SQL formatieren, Auswahl oder alles (Umschalt+Alt+F)",
    formatFailed: "SQL konnte nicht formatiert werden",
    cancelFailed: "Abbrechen fehlgeschlagen",
    confirmTitle: (name: string) => `Änderungen an „${name}“ ausführen?`,
    confirmDescription:
        "Diese Verbindung verlangt eine Bestätigung. Folgende Statements ändern Daten oder Struktur:",
    execute: "Ausführen",
    editorLabel: (title: string) => `SQL-Editor ${title}`,
    placeholder: "SQL eingeben …",
    emptyHint:
        "Strg+Enter führt das Statement am Cursor aus, Strg+⇧+Enter das ganze Skript, Strg+. bricht ab.",
    status: {
        skipped: "Nicht ausgeführt",
        running: "Läuft…",
        pending: "Wartet",
        failed: "Fehler",
        rows: (rows: number, truncated: boolean) =>
            `${n(rows, "Zeile", "Zeilen")}${truncated ? ", Limit erreicht" : ""}`,
        affected: (rows: number) => `${n(rows, "Zeile", "Zeilen")} betroffen`,
        cancelled: "Abgebrochen",
        statements: (done: number, total: number) => `${done} von ${total} Statements`,
        waiting: "Warte auf Ergebnis…",
    },
    results: {
        label: "Ergebnisse",
        result: (index: number) => `Ergebnis ${index}`,
        messages: "Meldungen",
        grid: "Abfrageergebnis",
        size: (rows: number, columns: number) =>
            `${n(rows, "Zeile", "Zeilen")} · ${n(columns, "Spalte", "Spalten")}`,
        limitReached: "Limit erreicht",
    },
    export: {
        button: "Exportieren",
        csv: "CSV (Excel-kompatibel)",
        json: "JSON",
        done: (rows: number) => `${n(rows, "Zeile", "Zeilen")} exportiert`,
        failed: "Export fehlgeschlagen",
    },
};

export const en: typeof de = {
    run: "Run",
    runHint: "Statement at cursor or selection (Ctrl+Enter)",
    all: "All",
    allHint: "Run whole script (Ctrl+Shift+Enter)",
    cancel: "Cancel",
    database: "Database",
    noDatabase: "No database",
    readOnly: "Read-only",
    confirmBadge: "Changes need confirmation",
    startFailed: "The query could not be started",
    format: "Format",
    formatHint: "Format SQL, selection or everything (Shift+Alt+F)",
    formatFailed: "The SQL could not be formatted",
    cancelFailed: "Cancelling failed",
    confirmTitle: (name: string) => `Run changes on “${name}”?`,
    confirmDescription:
        "This connection asks for confirmation. These statements change data or structure:",
    execute: "Run",
    editorLabel: (title: string) => `SQL editor ${title}`,
    placeholder: "Enter SQL …",
    emptyHint:
        "Ctrl+Enter runs the statement at the cursor, Ctrl+Shift+Enter the whole script, Ctrl+. cancels.",
    status: {
        skipped: "Not run",
        running: "Running…",
        pending: "Waiting",
        failed: "Error",
        rows: (rows: number, truncated: boolean) =>
            `${nEn(rows, "row", "rows")}${truncated ? ", limit reached" : ""}`,
        affected: (rows: number) => `${nEn(rows, "row", "rows")} affected`,
        cancelled: "Cancelled",
        statements: (done: number, total: number) => `${done} of ${total} statements`,
        waiting: "Waiting for result…",
    },
    results: {
        label: "Results",
        result: (index: number) => `Result ${index}`,
        messages: "Messages",
        grid: "Query result",
        size: (rows: number, columns: number) =>
            `${nEn(rows, "row", "rows")} · ${nEn(columns, "column", "columns")}`,
        limitReached: "Limit reached",
    },
    export: {
        button: "Export",
        csv: "CSV (Excel compatible)",
        json: "JSON",
        done: (rows: number) => `${nEn(rows, "row", "rows")} exported`,
        failed: "Export failed",
    },
};
