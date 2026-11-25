export const de = {
    window: {
        minimize: "Minimieren",
        maximize: "Maximieren",
        restore: "Wiederherstellen",
        close: "Schließen",
    },
    welcome: {
        empty: "Lege deine erste Verbindung zu MySQL, MariaDB oder PostgreSQL an.",
        ready: "Wähle links eine Verbindung, um Abfragen und Tabellen zu öffnen.",
        newConnection: "Neue Verbindung",
        palette: "Befehle und Tabellen suchen",
        runCurrent: "Statement am Cursor ausführen",
        runAll: "Ganzes Skript ausführen",
        newQuery: "Neue Abfrage",
        settings: "Einstellungen öffnen",
    },
    tabs: {
        label: "Offene Tabs",
        close: (title: string) => `${title} schließen`,
        newQuery: "Neue Abfrage",
        newQueryHint: "Neue Abfrage (Strg+T)",
        queryTitle: (counter: number) => `Abfrage ${counter}`,
        closeFailed: "Tab konnte nicht sauber geschlossen werden",
    },
};

export const en: typeof de = {
    window: {
        minimize: "Minimize",
        maximize: "Maximize",
        restore: "Restore",
        close: "Close",
    },
    welcome: {
        empty: "Create your first connection to MySQL, MariaDB or PostgreSQL.",
        ready: "Pick a connection on the left to open queries and tables.",
        newConnection: "New connection",
        palette: "Search commands and tables",
        runCurrent: "Run statement at cursor",
        runAll: "Run whole script",
        newQuery: "New query",
        settings: "Open settings",
    },
    tabs: {
        label: "Open tabs",
        close: (title: string) => `Close ${title}`,
        newQuery: "New query",
        newQueryHint: "New query (Ctrl+T)",
        queryTitle: (counter: number) => `Query ${counter}`,
        closeFailed: "The tab could not be closed cleanly",
    },
};
