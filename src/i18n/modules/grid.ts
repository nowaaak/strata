export const de = {
    copy: "Kopieren",
    copyWithHeaders: "Mit Spaltennamen kopieren",
    edit: "Bearbeiten",
    editInEditor: "Im Editor bearbeiten…",
    setNull: "Auf NULL setzen",
    deleteRow: "Zeile löschen",
    deleteRows: "Zeilen löschen",
    tooLarge: "Auswahl zu groß",
    tooLargeDescription: (limit: string) =>
        `Kopiert werden höchstens ${limit} Zeilen. Für mehr bitte exportieren.`,
    copiedRows: (rows: string) => `${rows} Zeilen kopiert`,
    editCell: (column: string) => `${column} bearbeiten`,
    loadFailed: "Zeilen konnten nicht geladen werden",
    keys: { copy: "Strg+C", copyWithHeaders: "Strg+⇧+C", edit: "F2", delete: "Entf" },
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
    tooLargeDescription: (limit: string) =>
        `At most ${limit} rows can be copied. Please export for more.`,
    copiedRows: (rows: string) => `${rows} rows copied`,
    editCell: (column: string) => `Edit ${column}`,
    loadFailed: "Rows could not be loaded",
    keys: { copy: "Ctrl+C", copyWithHeaders: "Ctrl+Shift+C", edit: "F2", delete: "Del" },
};
