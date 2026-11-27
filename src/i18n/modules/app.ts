export const de = {
    window: {
        minimize: "Minimieren",
        maximize: "Maximieren",
        restore: "Wiederherstellen",
        close: "Schließen",
    },
    welcome: {
        empty: "Lege deine erste Verbindung zu MySQL, MariaDB, PostgreSQL oder einer SQLite-Datei an.",
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
        newQueryHint: "Neue Abfrage",
        queryTitle: (counter: number) => `Abfrage ${counter}`,
        closeFailed: "Tab konnte nicht sauber geschlossen werden",
    },
    workspace: {
        disconnected: "Nicht verbunden",
        disconnectedText: (name: string) =>
            `„${name}“ ist getrennt. Der Tab bleibt erhalten und läuft weiter, sobald du verbindest.`,
        connect: "Verbinden",
        missingProfile: "Das Verbindungsprofil dieses Tabs existiert nicht mehr.",
        closeTab: "Tab schließen",
        loadFailed: "Gespeicherte Tabs konnten nicht geladen werden",
        saveFailed: "Tabs konnten nicht gespeichert werden",
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
        empty: "Create your first connection to MySQL, MariaDB, PostgreSQL or a SQLite file.",
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
        newQueryHint: "New query",
        queryTitle: (counter: number) => `Query ${counter}`,
        closeFailed: "The tab could not be closed cleanly",
    },
    workspace: {
        disconnected: "Not connected",
        disconnectedText: (name: string) =>
            `“${name}” is disconnected. The tab is kept and continues once you connect.`,
        connect: "Connect",
        missingProfile: "The connection profile of this tab no longer exists.",
        closeTab: "Close tab",
        loadFailed: "Saved tabs could not be loaded",
        saveFailed: "Tabs could not be saved",
    },
};
