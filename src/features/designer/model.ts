import type { AlterOp } from "@/bindings/AlterOp";
import type { ColumnDef } from "@/bindings/ColumnDef";
import type { ColumnDesign } from "@/bindings/ColumnDesign";
import type { DefaultValue } from "@/bindings/DefaultValue";
import type { Engine } from "@/bindings/Engine";
import type { IndexDesign } from "@/bindings/IndexDesign";
import type { NewTable } from "@/bindings/NewTable";
import type { TableDesign } from "@/bindings/TableDesign";
import type { TableTarget } from "@/bindings/TableTarget";

export type DefaultMode = DefaultValue["kind"];

export type ColumnRow = {
    key: string;
    original: ColumnDesign | null;
    name: string;
    dataType: string;
    nullable: boolean;
    defaultMode: DefaultMode;
    defaultValue: string;
    autoIncrement: boolean;
    primary: boolean;
    dropped: boolean;
};

export type IndexRow = {
    key: string;
    original: IndexDesign | null;
    name: string;
    columns: string[];
    unique: boolean;
    dropped: boolean;
};

export const TYPE_SUGGESTIONS: Record<Engine, string[]> = {
    mysql: [
        "INT",
        "BIGINT",
        "SMALLINT",
        "TINYINT(1)",
        "DECIMAL(10,2)",
        "DOUBLE",
        "VARCHAR(255)",
        "CHAR(36)",
        "TEXT",
        "LONGTEXT",
        "JSON",
        "DATE",
        "DATETIME",
        "TIMESTAMP",
        "TIME",
        "BOOLEAN",
        "BLOB",
        "BINARY(16)",
    ],
    postgres: [
        "integer",
        "bigint",
        "smallint",
        "numeric(10,2)",
        "double precision",
        "boolean",
        "text",
        "varchar(255)",
        "uuid",
        "jsonb",
        "json",
        "date",
        "timestamp",
        "timestamptz",
        "time",
        "interval",
        "bytea",
        "inet",
        "text[]",
    ],
};

let counter = 0;
export function rowKey(): string {
    counter += 1;
    return `row-${counter}`;
}

export function columnRows(design: TableDesign): ColumnRow[] {
    const primary = new Set(design.indexes.find((index) => index.primary)?.columns ?? []);
    return design.columns.map((column) => ({
        key: rowKey(),
        original: column,
        name: column.name,
        dataType: column.dataType,
        nullable: column.nullable,
        defaultMode: "keep",
        defaultValue: "",
        autoIncrement: column.autoIncrement,
        primary: primary.has(column.name),
        dropped: false,
    }));
}

export function indexRows(design: TableDesign): IndexRow[] {
    return design.indexes.map((index) => ({
        key: rowKey(),
        original: index,
        name: index.name,
        columns: index.columns,
        unique: index.unique,
        dropped: false,
    }));
}

export function newColumn(engine: Engine): ColumnRow {
    return {
        key: rowKey(),
        original: null,
        name: "",
        dataType: engine === "postgres" ? "text" : "VARCHAR(255)",
        nullable: true,
        defaultMode: "none",
        defaultValue: "",
        autoIncrement: false,
        primary: false,
        dropped: false,
    };
}

export function idColumn(engine: Engine): ColumnRow {
    return {
        ...newColumn(engine),
        name: "id",
        dataType: engine === "postgres" ? "bigint" : "INT",
        nullable: false,
        autoIncrement: true,
        primary: true,
    };
}

function defaultValue(row: ColumnRow): DefaultValue {
    switch (row.defaultMode) {
        case "text":
            return { kind: "text", value: row.defaultValue };
        case "expression":
            return { kind: "expression", value: row.defaultValue };
        case "keep":
            return { kind: "keep" };
        case "null":
            return { kind: "null" };
        case "none":
            return { kind: "none" };
    }
}

function definition(row: ColumnRow): ColumnDef {
    return {
        name: row.name.trim(),
        dataType: row.dataType.trim(),
        nullable: row.nullable,
        default: defaultValue(row),
        autoIncrement: row.autoIncrement,
    };
}

function normalizeType(value: string): string {
    return value.trim().replace(/\s+/g, " ").toLowerCase();
}

export function isChanged(row: ColumnRow): boolean {
    const original = row.original;
    if (!original) {
        return false;
    }
    return (
        row.name.trim() !== original.name ||
        normalizeType(row.dataType) !== normalizeType(original.dataType) ||
        row.nullable !== original.nullable ||
        row.defaultMode !== "keep" ||
        row.autoIncrement !== original.autoIncrement
    );
}

export function alterOps(columns: ColumnRow[], indexes: IndexRow[]): AlterOp[] {
    const ops: AlterOp[] = [];
    for (const row of columns) {
        if (row.original && row.dropped) {
            ops.push({ op: "drop_column", name: row.original.name });
        } else if (!row.original && !row.dropped) {
            ops.push({ op: "add_column", column: definition(row) });
        } else if (row.original && isChanged(row)) {
            ops.push({ op: "change_column", name: row.original.name, column: definition(row) });
        }
    }
    for (const index of indexes) {
        if (index.original && index.dropped) {
            ops.push({ op: "drop_index", name: index.original.name });
        } else if (!index.original && !index.dropped) {
            ops.push({
                op: "add_index",
                name: index.name.trim(),
                columns: index.columns,
                unique: index.unique,
            });
        }
    }
    return ops;
}

export function newTable(target: TableTarget, columns: ColumnRow[]): NewTable {
    const kept = columns.filter((row) => !row.dropped);
    return {
        target,
        columns: kept.map(definition),
        primaryKey: kept.filter((row) => row.primary).map((row) => row.name.trim()),
    };
}

export function liveColumnNames(columns: ColumnRow[]): string[] {
    return columns
        .filter((row) => !row.dropped && row.name.trim() !== "")
        .map((row) => row.name.trim());
}
