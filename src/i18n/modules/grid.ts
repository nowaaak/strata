import { de as n, en as nEn } from "../plural";

export const de = {
    copy: "Kopieren",
    copyWithHeaders: "Mit Spaltennamen kopieren",
    edit: "Bearbeiten",
    editInEditor: "Im Editor bearbeiten…",
    setNull: "Auf NULL setzen",
    deleteRow: "Zeile löschen",
    deleteRows: "Zeilen löschen",
    tooLarge: "Auswahl zu groß",
    tooLargeDescription: (limit: number) =>
        `Kopiert werden höchstens ${n(limit, "Zeile", "Zeilen")}. Für mehr bitte exportieren.`,
    copiedRows: (rows: number) => `${n(rows, "Zeile", "Zeilen")} kopiert`,
    editCell: (column: string) => `${column} bearbeiten`,
    loadFailed: "Zeilen konnten nicht geladen werden",
    keys: {
        copy: (mod: string) => `${mod}+C`,
        copyWithHeaders: (mod: string) => `${mod}+⇧+C`,
        edit: "F2",
        delete: "Entf",
    },
};

export const en: typeof de = {
    copy: "Copy",
    copyWithHeaders: "Copy with column names",
    edit: "Edit",
    editInEditor: "Edit in editor…",
    setNull: "Set to NULL",
    deleteRow: "Delete row",
    deleteRows: "Delete rows",
    tooLarge: "Selection too large",
    tooLargeDescription: (limit: number) =>
        `At most ${nEn(limit, "row", "rows")} can be copied. Please export for more.`,
    copiedRows: (rows: number) => `${nEn(rows, "row", "rows")} copied`,
    editCell: (column: string) => `Edit ${column}`,
    loadFailed: "Rows could not be loaded",
    keys: {
        copy: (mod: string) => `${mod}+C`,
        copyWithHeaders: (mod: string) => `${mod}+Shift+C`,
        edit: "F2",
        delete: "Del",
    },
};
