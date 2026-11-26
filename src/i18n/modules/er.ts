import { de as n, en as nEn } from "../plural";

export const de = {
    menu: "ER-Diagramm…",
    title: (name: string) => `ER-Diagramm von „${name}“`,
    description:
        "Tabellen, Schlüssel und Fremdschlüssel. Pfeile zeigen auf die referenzierte Tabelle.",
    loading: "Struktur wird geladen…",
    loadFailed: "Diagramm konnte nicht geladen werden",
    empty: "Keine Tabellen vorhanden",
    search: "Tabelle suchen, Enter springt hin",
    compact: "Nur Schlüsselspalten",
    onlyRelated: "Nur Tabellen mit Beziehungen",
    count: (tables: number, keys: number) =>
        `${n(tables, "Tabelle", "Tabellen")}, ${n(keys, "Beziehung", "Beziehungen")}`,
    matches: (count: number) => n(count, "Treffer", "Treffer"),
    truncated: (count: number) =>
        `Das Schema ist sehr groß. Gezeigt werden die ersten ${count} Tabellen in alphabetischer Reihenfolge.`,
    hint: "Doppelklick auf eine Tabelle öffnet ihre Daten. Tabellen lassen sich verschieben, Mausrad zoomt. * heißt NOT NULL.",
    primary: "Primärschlüssel",
    foreign: "Fremdschlüssel",
    noKeys: "keine Schlüsselspalten",
};

export const en: typeof de = {
    menu: "ER diagram…",
    title: (name: string) => `ER diagram of “${name}”`,
    description: "Tables, keys and foreign keys. Arrows point to the referenced table.",
    loading: "Loading structure…",
    loadFailed: "The diagram could not be loaded",
    empty: "No tables",
    search: "Find a table, Enter jumps to it",
    compact: "Key columns only",
    onlyRelated: "Only tables with relations",
    count: (tables: number, keys: number) =>
        `${nEn(tables, "table", "tables")}, ${nEn(keys, "relation", "relations")}`,
    matches: (count: number) => nEn(count, "match", "matches"),
    truncated: (count: number) =>
        `The schema is very large. The first ${count} tables in alphabetical order are shown.`,
    hint: "Double click a table to open its data. Tables can be dragged, the mouse wheel zooms. * means NOT NULL.",
    primary: "Primary key",
    foreign: "Foreign key",
    noKeys: "no key columns",
};
