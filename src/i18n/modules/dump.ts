import { de as n, en as nEn } from "../plural";

export const de = {
    menu: "SQL-Dump erstellen…",
    title: (name: string) => `SQL-Dump von „${name}“`,
    description:
        "Schreibt Struktur und Daten als SQL-Datei, die sich mit Strata oder dem Kommandozeilen-Client wieder einspielen lässt.",
    objects: "Tabellen und Views",
    routines: "Funktionen und Prozeduren, dazu Trigger der gewählten Tabellen",
    routinesMysql: "Funktionen, Prozeduren und Events, dazu Trigger der gewählten Tabellen",
    all: "Alle",
    none: "Keine",
    structure: "Struktur (CREATE TABLE, Indizes, Fremdschlüssel)",
    data: "Daten (INSERT)",
    dropExisting: "Vorhandene Tabellen beim Einspielen zuerst löschen (DROP)",
    loading: "Tabellen werden geladen…",
    empty: "Keine Tabellen in dieser Datenbank",
    selected: (count: number, total: number) =>
        `${count} von ${n(total, "Objekt", "Objekten")} gewählt`,
    run: "Speichern unter…",
    running: (table: string, done: number, total: number, rows: number) =>
        `Dump läuft: ${table} (${done + 1}/${total}), ${n(rows, "Zeile", "Zeilen")}…`,
    done: (tables: number, rows: number) =>
        `Dump fertig: ${n(tables, "Objekt", "Objekte")}, ${n(rows, "Zeile", "Zeilen")}`,
    cancelled: "Dump abgebrochen",
    failed: "Dump fehlgeschlagen",
    cancel: "Abbrechen",
    fileFilter: "SQL-Dateien",
};

export const en: typeof de = {
    menu: "Create SQL dump…",
    title: (name: string) => `SQL dump of “${name}”`,
    description:
        "Writes structure and data as an SQL file that can be loaded again with Strata or the command line client.",
    objects: "Tables and views",
    routines: "Functions and procedures, plus triggers of the selected tables",
    routinesMysql: "Functions, procedures and events, plus triggers of the selected tables",
    all: "All",
    none: "None",
    structure: "Structure (CREATE TABLE, indexes, foreign keys)",
    data: "Data (INSERT)",
    dropExisting: "Drop existing tables first when loading (DROP)",
    loading: "Loading tables…",
    empty: "No tables in this database",
    selected: (count: number, total: number) =>
        `${count} of ${nEn(total, "object", "objects")} selected`,
    run: "Save as…",
    running: (table: string, done: number, total: number, rows: number) =>
        `Dumping ${table} (${done + 1}/${total}), ${nEn(rows, "row", "rows")}…`,
    done: (tables: number, rows: number) =>
        `Dump done: ${nEn(tables, "object", "objects")}, ${nEn(rows, "row", "rows")}`,
    cancelled: "Dump cancelled",
    failed: "Dump failed",
    cancel: "Cancel",
    fileFilter: "SQL files",
};
