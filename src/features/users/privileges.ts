import type { Engine } from "@/bindings/Engine";
import type { GrantScope } from "@/bindings/GrantScope";
import type { UserAccount } from "@/bindings/UserAccount";
import type { UserRef } from "@/bindings/UserRef";

export type ScopeKind = GrantScope["kind"];

const MYSQL_TABLE = [
    "SELECT",
    "INSERT",
    "UPDATE",
    "DELETE",
    "CREATE",
    "DROP",
    "ALTER",
    "INDEX",
    "REFERENCES",
    "TRIGGER",
    "CREATE VIEW",
    "SHOW VIEW",
];

const MYSQL_DATABASE = [
    ...MYSQL_TABLE,
    "CREATE ROUTINE",
    "ALTER ROUTINE",
    "EXECUTE",
    "EVENT",
    "LOCK TABLES",
    "CREATE TEMPORARY TABLES",
];

const MYSQL_GLOBAL = [
    ...MYSQL_DATABASE,
    "PROCESS",
    "RELOAD",
    "SHOW DATABASES",
    "CREATE USER",
    "REPLICATION CLIENT",
    "REPLICATION SLAVE",
    "FILE",
    "SHUTDOWN",
    "SUPER",
];

const PG_TABLE = ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"];

export const ALL_PRIVILEGES = "ALL PRIVILEGES";

export function scopeKinds(engine: Engine): ScopeKind[] {
    return engine === "postgres"
        ? ["database", "schema", "all_tables", "table"]
        : ["global", "database", "table"];
}

export function privilegeChoices(engine: Engine, scope: ScopeKind): string[] {
    if (engine === "postgres") {
        switch (scope) {
            case "database":
                return ["CONNECT", "CREATE", "TEMPORARY"];
            case "schema":
                return ["USAGE", "CREATE"];
            default:
                return PG_TABLE;
        }
    }
    switch (scope) {
        case "global":
            return MYSQL_GLOBAL;
        case "database":
            return MYSQL_DATABASE;
        default:
            return MYSQL_TABLE;
    }
}

export function buildScope(
    kind: ScopeKind,
    database: string,
    schema: string,
    table: string,
): GrantScope | null {
    switch (kind) {
        case "global":
            return { kind: "global" };
        case "database":
            return database ? { kind: "database", database } : null;
        case "schema":
            return schema ? { kind: "schema", schema } : null;
        case "all_tables":
            return schema ? { kind: "all_tables", schema } : null;
        case "table":
            return database && table
                ? { kind: "table", database, schema: schema || null, table }
                : null;
    }
}

export function scopeObject(scope: GrantScope): string {
    switch (scope.kind) {
        case "global":
            return "*.*";
        case "database":
            return scope.database;
        case "schema":
            return scope.schema;
        case "all_tables":
            return `${scope.schema}.*`;
        case "table":
            return scope.schema
                ? `${scope.schema}.${scope.table}`
                : `${scope.database}.${scope.table}`;
    }
}

export function refOf(account: UserAccount): UserRef {
    return { name: account.name, host: account.host };
}

export function accountKey(account: UserRef): string {
    return account.host === null ? account.name : `${account.name}@${account.host}`;
}

export function accountLabel(account: UserRef): string {
    return account.host === null ? account.name : `${account.name}@${account.host}`;
}

export function filterAccounts(accounts: UserAccount[], search: string): UserAccount[] {
    const term = search.trim().toLowerCase();
    if (term === "") {
        return accounts;
    }
    return accounts.filter((account) => accountLabel(account).toLowerCase().includes(term));
}
