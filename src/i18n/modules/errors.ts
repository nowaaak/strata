import type { DbHintKey } from "@/lib/dbErrors";

export const de = {
    hints: {
        accessDenied:
            "Anmeldung abgelehnt: Benutzername oder Passwort stimmt nicht, oder der Benutzer darf sich von diesem Rechner aus nicht anmelden.",
        databaseAccessDenied: "Der Benutzer hat keinen Zugriff auf diese Datenbank.",
        unknownDatabase: "Diese Datenbank gibt es auf dem Server nicht.",
        noDatabase:
            "Es ist keine Datenbank ausgewählt. Wähle oben eine aus oder schreibe datenbank.tabelle.",
        unknownColumn:
            "Eine Spalte in der Abfrage gibt es in dieser Tabelle nicht. Prüfe Schreibweise und Tabellen-Alias.",
        unknownTable:
            "Die Tabelle oder View gibt es nicht. Prüfe Schreibweise, Datenbank und Schema.",
        unknownFunction:
            "Die Funktion gibt es nicht oder sie passt nicht zu den Datentypen der Argumente.",
        unknownSchema: "Dieses Schema gibt es in der Datenbank nicht.",
        duplicate:
            "Der Wert ist schon vorhanden, aber die Spalte muss eindeutig sein (Primärschlüssel oder Unique-Index).",
        syntax: "Die Abfrage enthält einen Syntaxfehler. Die Stelle ist im Editor markiert, wenn der Server sie meldet.",
        notNull: "Eine Pflichtspalte (NOT NULL) hat keinen Wert bekommen.",
        noDefault: "Eine Pflichtspalte ohne Standardwert hat keinen Wert bekommen.",
        invalidValue:
            "Ein Wert passt nicht zum Datentyp der Spalte, zum Beispiel Text in einer Zahlen- oder Datumsspalte.",
        tooLong: "Ein Text ist länger, als die Spalte erlaubt.",
        outOfRange: "Eine Zahl ist zu groß oder zu klein für den Datentyp der Spalte.",
        referenced:
            "Andere Zeilen verweisen über einen Fremdschlüssel auf diese Zeile. Lösche oder ändere zuerst diese.",
        missingReference:
            "Der Fremdschlüssel zeigt auf eine Zeile, die es in der referenzierten Tabelle nicht gibt.",
        lockTimeout:
            "Eine andere Verbindung hält eine Sperre auf diesen Daten. Versuche es gleich noch einmal oder sieh in der Prozessliste nach.",
        deadlock:
            "Zwei Transaktionen haben sich gegenseitig blockiert. Der Server hat diese abgebrochen, du kannst sie wiederholen.",
        permission: "Dem Benutzer fehlt das Recht für diese Aktion.",
        interrupted: "Die Abfrage wurde abgebrochen.",
        readOnly: "Die Sitzung ist schreibgeschützt, Änderungen sind nicht erlaubt.",
        tooManyConnections:
            "Der Server nimmt keine weiteren Verbindungen an. Schließe nicht benötigte Verbindungen.",
        refused:
            "Der Server ist nicht erreichbar. Läuft er, stimmen Host und Port, und lässt die Firewall die Verbindung zu?",
        timeout: "Der Server hat nicht rechtzeitig geantwortet. Prüfe Netzwerk, VPN und Firewall.",
        hostUnknown:
            "Der Hostname ist unbekannt. Prüfe die Schreibweise oder nutze die IP-Adresse.",
        tls: "Die verschlüsselte Verbindung ist gescheitert. Prüfe die TLS-Einstellung der Verbindung und das Server-Zertifikat.",
    } satisfies Record<DbHintKey, string>,
    friendly: {
        io: "Dateizugriff fehlgeschlagen",
        json: "Datei ist beschädigt oder unlesbar",
        database: "Datenbankfehler",
        connection: "Verbindung fehlgeschlagen",
        secret: "Zugriff auf den Passwortspeicher des Systems fehlgeschlagen",
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
    hints: {
        accessDenied:
            "Login refused: the user name or password is wrong, or the user may not log in from this computer.",
        databaseAccessDenied: "The user has no access to this database.",
        unknownDatabase: "This database does not exist on the server.",
        noDatabase: "No database is selected. Pick one above or write database.table.",
        unknownColumn:
            "A column in the query does not exist in this table. Check the spelling and table aliases.",
        unknownTable: "The table or view does not exist. Check the spelling, database and schema.",
        unknownFunction: "The function does not exist or does not match the argument types.",
        unknownSchema: "This schema does not exist in the database.",
        duplicate:
            "The value already exists, but the column must be unique (primary key or unique index).",
        syntax: "The query has a syntax error. The position is marked in the editor when the server reports it.",
        notNull: "A required column (NOT NULL) got no value.",
        noDefault: "A required column without a default got no value.",
        invalidValue:
            "A value does not fit the column type, for example text in a number or date column.",
        tooLong: "A text is longer than the column allows.",
        outOfRange: "A number is too large or too small for the column type.",
        referenced:
            "Other rows refer to this row through a foreign key. Delete or change them first.",
        missingReference:
            "The foreign key points to a row that does not exist in the referenced table.",
        lockTimeout:
            "Another connection holds a lock on this data. Try again shortly or check the process list.",
        deadlock:
            "Two transactions blocked each other. The server cancelled this one, you can run it again.",
        permission: "The user lacks the privilege for this action.",
        interrupted: "The query was cancelled.",
        readOnly: "The session is read-only, changes are not allowed.",
        tooManyConnections:
            "The server accepts no more connections. Close connections you do not need.",
        refused:
            "The server cannot be reached. Is it running, are host and port right, and does the firewall allow the connection?",
        timeout: "The server did not answer in time. Check the network, VPN and firewall.",
        hostUnknown: "The host name is unknown. Check the spelling or use the IP address.",
        tls: "The encrypted connection failed. Check the TLS setting of the connection and the server certificate.",
    },
    friendly: {
        io: "File access failed",
        json: "File is damaged or unreadable",
        database: "Database error",
        connection: "Connection failed",
        secret: "Could not access the system password store",
        invalid_input: "Invalid input",
        not_found: "Not found",
        read_only: "The connection is read-only",
        busy: "A query is still running in this tab",
        ssh_host_key_unknown: "Unknown SSH server key",
        ssh_host_key_changed: "Warning: the SSH server key has changed",
        internal: "Unexpected error",
    },
};
