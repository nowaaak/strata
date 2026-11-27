import type { AlterOp } from "@/bindings/AlterOp";
import type { ColumnDef } from "@/bindings/ColumnDef";
import type { ColumnPosition } from "@/bindings/ColumnPosition";
import type { ColumnDesign } from "@/bindings/ColumnDesign";
import type { DefaultValue } from "@/bindings/DefaultValue";
import type { Engine } from "@/bindings/Engine";
import type { ForeignKeyDesign } from "@/bindings/ForeignKeyDesign";
import type { ForeignKeyRule } from "@/bindings/ForeignKeyRule";
import type { IndexDesign } from "@/bindings/IndexDesign";
import type { NewTable } from "@/bindings/NewTable";
import type { TableDesign } from "@/bindings/TableDesign";
import type { TableTarget } from "@/bindings/TableTarget";

export type DefaultMode = DefaultValue["kind"];

export type ColumnRow = {
    key: string;
    original: ColumnDesign | null;
    originalPrevious: string | null;
    name: string;
    dataType: string;
    nullable: boolean;
    defaultMode: DefaultMode;
    defaultValue: string;
    autoIncrement: boolean;
    primary: boolean;
    comment: string;
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

export type ForeignKeyRow = {
    key: string;
    original: ForeignKeyDesign | null;
    name: string;
    columns: string[];
    targetContainer: string | null;
    targetTable: string;
    targetColumns: string[];
    onDelete: ForeignKeyRule;
    onUpdate: ForeignKeyRule;
    dropped: boolean;
};

export const FOREIGN_KEY_RULES: ForeignKeyRule[] = [
    "no_action",
    "restrict",
    "cascade",
    "set_null",
    "set_default",
];

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
    sqlite: ["INTEGER", "TEXT", "REAL", "NUMERIC", "BLOB", "BOOLEAN", "DATE", "DATETIME", "JSON"],
};

let counter = 0;
export function rowKey(): string {
    counter += 1;
    return `row-${counter}`;
}

export function columnRows(design: TableDesign): ColumnRow[] {
    const primary = new Set(design.indexes.find((index) => index.primary)?.columns ?? []);
    return design.columns.map((column, index) => ({
        key: rowKey(),
        original: column,
        originalPrevious: design.columns[index - 1]?.name ?? null,
        name: column.name,
        dataType: column.dataType,
        nullable: column.nullable,
        defaultMode: "keep",
        defaultValue: "",
        autoIncrement: column.autoIncrement,
        primary: primary.has(column.name),
        comment: column.comment ?? "",
        dropped: false,
    }));
}

export function foreignKeyRows(design: TableDesign): ForeignKeyRow[] {
    return design.foreignKeys.map((key) => ({
        key: rowKey(),
        original: key,
        name: key.name,
        columns: key.columns,
        targetContainer: key.target.schema ?? key.target.database,
        targetTable: key.target.table,
        targetColumns: key.targetColumns,
        onDelete: key.onDelete,
        onUpdate: key.onUpdate,
        dropped: false,
    }));
}

export function moveRow<T extends { key: string }>(rows: T[], key: string, delta: number): T[] {
    const from = rows.findIndex((row) => row.key === key);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= rows.length) {
        return rows;
    }
    const next = [...rows];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved!);
    return next;
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
        originalPrevious: null,
        name: "",
        dataType: { mysql: "VARCHAR(255)", postgres: "text", sqlite: "TEXT" }[engine],
        nullable: true,
        defaultMode: "none",
        defaultValue: "",
        autoIncrement: false,
        primary: false,
        comment: "",
        dropped: false,
    };
}

export function idColumn(engine: Engine): ColumnRow {
    return {
        ...newColumn(engine),
        name: "id",
        dataType: { mysql: "INT", postgres: "bigint", sqlite: "INTEGER" }[engine],
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
    const column: ColumnDef = {
        name: row.name.trim(),
        dataType: row.dataType.trim(),
        nullable: row.nullable,
        default: defaultValue(row),
        autoIncrement: row.autoIncrement,
    };
    const comment = row.comment.trim();
    if (comment !== (row.original?.comment ?? "")) {
        column.comment = comment;
    }
    return column;
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
        row.autoIncrement !== original.autoIncrement ||
        row.comment.trim() !== (original.comment ?? "")
    );
}

export function isMoved(rows: ColumnRow[], row: ColumnRow): boolean {
    if (!row.original || row.dropped) {
        return false;
    }
    const kept = rows.filter((candidate) => !candidate.dropped);
    const previous = kept[kept.indexOf(row) - 1];
    const previousName = previous ? (previous.original?.name ?? "") : null;
    return previous?.original === null || previousName !== row.originalPrevious;
}

function primaryKeyOps(columns: ColumnRow[], indexes: IndexRow[]): AlterOp[] {
    const original = indexes.find((index) => index.original?.primary)?.original ?? null;
    const originalColumns = original?.columns ?? [];
    const kept = columns.filter((row) => !row.dropped);
    const stays = originalColumns
        .map((name) => kept.find((row) => row.primary && row.original?.name === name))
        .filter((row): row is ColumnRow => row !== undefined);
    const added = kept.filter((row) => row.primary && !stays.includes(row));
    const next = [...stays, ...added];
    if (added.length === 0 && stays.length === originalColumns.length) {
        return [];
    }
    const ops: AlterOp[] = [];
    if (original) {
        ops.push({ op: "drop_index", name: original.name });
    }
    if (next.length > 0) {
        ops.push({ op: "add_primary_key", columns: next.map((row) => row.name.trim()) });
    }
    return ops;
}

function position(kept: ColumnRow[], row: ColumnRow): ColumnPosition {
    const previous = kept[kept.indexOf(row) - 1];
    return previous ? { kind: "after", column: previous.name.trim() } : { kind: "first" };
}

export function alterOps(
    columns: ColumnRow[],
    indexes: IndexRow[],
    foreignKeys: ForeignKeyRow[] = [],
    reorder = false,
): AlterOp[] {
    const ops: AlterOp[] = [];
    const kept = columns.filter((row) => !row.dropped);
    for (const foreignKey of foreignKeys) {
        if (foreignKey.original && foreignKey.dropped) {
            ops.push({ op: "drop_foreign_key", name: foreignKey.original.name });
        }
    }
    for (const row of columns) {
        if (row.original && row.dropped) {
            ops.push({ op: "drop_column", name: row.original.name });
        }
    }
    kept.forEach((row, index) => {
        if (!row.original) {
            const op: AlterOp = { op: "add_column", column: definition(row) };
            if (reorder && kept.slice(index + 1).some((later) => later.original)) {
                op.position = position(kept, row);
            }
            ops.push(op);
            return;
        }
        const moved = reorder && isMoved(columns, row);
        if (moved || isChanged(row)) {
            const op: AlterOp = {
                op: "change_column",
                name: row.original.name,
                column: definition(row),
            };
            if (moved) {
                op.position = position(kept, row);
            }
            ops.push(op);
        }
    });
    ops.push(...primaryKeyOps(columns, indexes));
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
    for (const foreignKey of foreignKeys) {
        if (!foreignKey.original && !foreignKey.dropped) {
            const op: AlterOp = {
                op: "add_foreign_key",
                name: foreignKey.name.trim(),
                columns: foreignKey.columns,
                target_table: foreignKey.targetTable,
                target_columns: foreignKey.targetColumns,
                on_delete: foreignKey.onDelete,
                on_update: foreignKey.onUpdate,
            };
            if (foreignKey.targetContainer !== null) {
                op.target_container = foreignKey.targetContainer;
            }
            ops.push(op);
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
