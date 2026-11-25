export const de = {
    friendly: {
        io: "Dateizugriff fehlgeschlagen",
        json: "Datei ist beschädigt oder unlesbar",
        database: "Datenbankfehler",
        connection: "Verbindung fehlgeschlagen",
        secret: "Zugriff auf die Windows-Anmeldeinformationen fehlgeschlagen",
        invalid_input: "Ungültige Eingabe",
        not_found: "Nicht gefunden",
        read_only: "Die Verbindung ist schreibgeschützt",
        busy: "In diesem Tab läuft noch eine Abfrage",
        ssh_host_key_unknown: "Unbekannter SSH-Server-Schlüssel",
        ssh_host_key_changed: "Achtung: Der SSH-Server-Schlüssel hat sich geändert",
        internal: "Unerwarteter Fehler",
    } as Record<string, string>,
};

export const en: typeof de = {
    friendly: {
        io: "File access failed",
        json: "File is damaged or unreadable",
        database: "Database error",
        connection: "Connection failed",
        secret: "Could not access the Windows credentials",
        invalid_input: "Invalid input",
        not_found: "Not found",
        read_only: "The connection is read-only",
        busy: "A query is still running in this tab",
        ssh_host_key_unknown: "Unknown SSH server key",
        ssh_host_key_changed: "Warning: the SSH server key has changed",
        internal: "Unexpected error",
    },
};
