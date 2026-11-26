export type DbHintKey =
    | "accessDenied"
    | "databaseAccessDenied"
    | "unknownDatabase"
    | "noDatabase"
    | "unknownColumn"
    | "unknownTable"
    | "unknownFunction"
    | "unknownSchema"
    | "duplicate"
    | "syntax"
    | "notNull"
    | "noDefault"
    | "invalidValue"
    | "tooLong"
    | "outOfRange"
    | "referenced"
    | "missingReference"
    | "lockTimeout"
    | "deadlock"
    | "permission"
    | "interrupted"
    | "readOnly"
    | "tooManyConnections"
    | "refused"
    | "timeout"
    | "hostUnknown"
    | "tls";

const MYSQL: Record<number, DbHintKey> = {
    1044: "databaseAccessDenied",
    1045: "accessDenied",
    1046: "noDatabase",
    1048: "notNull",
    1049: "unknownDatabase",
    1054: "unknownColumn",
    1062: "duplicate",
    1064: "syntax",
    1142: "permission",
    1143: "permission",
    1146: "unknownTable",
    1205: "lockTimeout",
    1213: "deadlock",
    1264: "outOfRange",
    1305: "unknownFunction",
    1317: "interrupted",
    1364: "noDefault",
    1366: "invalidValue",
    1406: "tooLong",
    1451: "referenced",
    1452: "missingReference",
    1792: "readOnly",
    1040: "tooManyConnections",
};

const POSTGRES: Record<string, DbHintKey> = {
    "23505": "duplicate",
    "23503": "missingReference",
    "23502": "notNull",
    "22001": "tooLong",
    "22P02": "invalidValue",
    "22007": "invalidValue",
    "22003": "outOfRange",
    "42P01": "unknownTable",
    "42703": "unknownColumn",
    "42601": "syntax",
    "42883": "unknownFunction",
    "3F000": "unknownSchema",
    "3D000": "unknownDatabase",
    "28P01": "accessDenied",
    "28000": "accessDenied",
    "42501": "permission",
    "40P01": "deadlock",
    "55P03": "lockTimeout",
    "57014": "interrupted",
    "25006": "readOnly",
    "53300": "tooManyConnections",
};

const SQLITE: Record<number, DbHintKey> = {
    1555: "duplicate",
    2067: "duplicate",
    1299: "notNull",
    5: "lockTimeout",
    6: "lockTimeout",
    8: "readOnly",
    9: "interrupted",
};

function sqliteHint(code: number, text: string): DbHintKey | null {
    const exact = SQLITE[code] ?? SQLITE[code & 0xff];
    if (exact) {
        return exact;
    }
    if (/^no such table/.test(text)) {
        return "unknownTable";
    }
    if (/^no such column/.test(text)) {
        return "unknownColumn";
    }
    if (/^no such function/.test(text)) {
        return "unknownFunction";
    }
    if (/syntax error/.test(text)) {
        return "syntax";
    }
    return null;
}

export function dbHintKey(message: string): DbHintKey | null {
    const mysql = /^ERROR (\d+) \(/.exec(message);
    if (mysql) {
        return MYSQL[Number(mysql[1])] ?? null;
    }
    const sqlite = /^SQLITE (\d+): (.*)/s.exec(message);
    if (sqlite) {
        return sqliteHint(Number(sqlite[1]), sqlite[2] ?? "");
    }
    const postgres = /^(?:ERROR|FATAL|PANIC) ([0-9A-Z]{5}):/.exec(message);
    if (postgres) {
        const code = postgres[1] ?? "";
        if (code === "23503" && /update or delete/i.test(message)) {
            return "referenced";
        }
        return POSTGRES[code] ?? null;
    }
    if (/10061|connection refused/i.test(message)) {
        return "refused";
    }
    if (/10060|timed out|timeout/i.test(message)) {
        return "timeout";
    }
    if (/11001|no such host|failed to lookup address|name or service not known/i.test(message)) {
        return "hostUnknown";
    }
    if (/certificate|tls|ssl|handshake/i.test(message)) {
        return "tls";
    }
    return null;
}
