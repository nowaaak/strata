import { de as n, en as nEn } from "../plural";

export const de = {
    menu: "CSV importieren…",
    button: "Importieren",
    title: (table: string) => `CSV in „${table}“ importieren`,
    description:
        "Alle Zeilen werden in einer Transaktion eingefügt. Schlägt eine fehl, wird nichts importiert.",
    chooseFile: "Datei wählen…",
    noFile: "Noch keine Datei gewählt",
    delimiter: "Trennzeichen",
    delimiters: {
        auto: "Automatisch",
        comma: "Komma",
        semicolon: "Semikolon",
        tab: "Tabulator",
        pipe: "Senkrechter Strich",
    },
    header: "Erste Zeile enthält Spaltennamen",
    emptyAsNull: "Leere Werte als NULL",
    decimalComma: "Dezimalkomma in Zahlenspalten (1.234,5)",
    detected: (encoding: string, delimiter: string, rows: number) =>
        `${encoding.toUpperCase()}, Trennzeichen ${delimiter}, ${n(rows, "Zeile", "Zeilen")}`,
    mapping: "Spaltenzuordnung",
    target: "Spalte der Tabelle",
    source: "Spalte der Datei",
    example: "Beispiel",
    skip: "nicht importieren",
    preview: "Vorschau der ersten Zeilen",
    summary: (rows: number, columns: number) =>
        `${n(rows, "Zeile", "Zeilen")} in ${n(columns, "Spalte", "Spalten")}`,
    run: "Importieren",
    running: (rows: number, total: number) =>
        `${rows.toLocaleString("de-DE")} von ${n(total, "Zeile", "Zeilen")}…`,
    done: (rows: number) => `${n(rows, "Zeile", "Zeilen")} importiert`,
    failed: "Import fehlgeschlagen",
    previewFailed: "Datei konnte nicht gelesen werden",
    fileFilter: "CSV-Dateien",
};

export const en: typeof de = {
    menu: "Import CSV…",
    button: "Import",
    title: (table: string) => `Import CSV into “${table}”`,
    description: "All rows are inserted in one transaction. If one fails, nothing is imported.",
    chooseFile: "Choose file…",
    noFile: "No file chosen yet",
    delimiter: "Delimiter",
    delimiters: {
        auto: "Automatic",
        comma: "Comma",
        semicolon: "Semicolon",
        tab: "Tab",
        pipe: "Pipe",
    },
    header: "First row contains column names",
    emptyAsNull: "Empty values as NULL",
    decimalComma: "Decimal comma in number columns (1.234,5)",
    detected: (encoding: string, delimiter: string, rows: number) =>
        `${encoding.toUpperCase()}, delimiter ${delimiter}, ${nEn(rows, "row", "rows")}`,
    mapping: "Column mapping",
    target: "Table column",
    source: "File column",
    example: "Example",
    skip: "do not import",
    preview: "Preview of the first rows",
    summary: (rows: number, columns: number) =>
        `${nEn(rows, "row", "rows")} into ${nEn(columns, "column", "columns")}`,
    run: "Import",
    running: (rows: number, total: number) =>
        `${rows.toLocaleString("en-US")} of ${nEn(total, "row", "rows")}…`,
    done: (rows: number) => `${nEn(rows, "row", "rows")} imported`,
    failed: "Import failed",
    previewFailed: "The file could not be read",
    fileFilter: "CSV files",
};
