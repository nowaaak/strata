import { describe, expect, it } from "vitest";
import type { TableDesign } from "@/bindings/TableDesign";
import {
    alterOps,
    columnRows,
    foreignKeyRows,
    idColumn,
    indexRows,
    moveRow,
    newColumn,
    newTable,
} from "./model";

const design: TableDesign = {
    columns: [
        {
            name: "id",
            dataType: "int",
            nullable: false,
            default: null,
            defaultExpression: false,
            autoIncrement: true,
            generated: false,
            onUpdate: null,
            collation: null,
            comment: null,
        },
        {
            name: "label",
            dataType: "varchar(50)",
            nullable: true,
            default: "neu",
            defaultExpression: false,
            autoIncrement: false,
            generated: false,
            onUpdate: null,
            collation: "utf8mb4_german2_ci",
            comment: null,
        },
    ],
    indexes: [
        {
            name: "PRIMARY",
            columns: ["id"],
            unique: true,
            primary: true,
            constraint: null,
            editable: true,
        },
        {
            name: "by_label",
            columns: ["label"],
            unique: false,
            primary: false,
            constraint: null,
            editable: true,
        },
    ],
    foreignKeys: [],
};

describe("designer model", () => {
    it("produces no operations without changes", () => {
        const columns = columnRows(design);
        expect(columns[0]?.primary).toBe(true);
        expect(alterOps(columns, indexRows(design))).toEqual([]);
    });

    it("ignores type spelling differences", () => {
        const columns = columnRows(design);
        columns[1] = { ...columns[1]!, dataType: " VARCHAR(50) " };
        expect(alterOps(columns, indexRows(design))).toEqual([]);
    });

    it("builds change, add, drop and index operations", () => {
        const columns = columnRows(design);
        columns[1] = { ...columns[1]!, name: "title", nullable: false };
        columns.push({
            ...newColumn("mysql"),
            name: "note",
            defaultMode: "text",
            defaultValue: "x",
        });
        columns.push({ ...newColumn("mysql"), name: "discarded", dropped: true });
        const indexes = indexRows(design);
        indexes[1] = { ...indexes[1]!, dropped: true };
        indexes.push({
            key: "new",
            original: null,
            name: " by_title ",
            columns: ["title"],
            unique: true,
            dropped: false,
        });
        expect(alterOps(columns, indexes)).toEqual([
            {
                op: "change_column",
                name: "label",
                column: {
                    name: "title",
                    dataType: "varchar(50)",
                    nullable: false,
                    default: { kind: "keep" },
                    autoIncrement: false,
                },
            },
            {
                op: "add_column",
                column: {
                    name: "note",
                    dataType: "VARCHAR(255)",
                    nullable: true,
                    default: { kind: "text", value: "x" },
                    autoIncrement: false,
                },
            },
            { op: "drop_index", name: "by_label" },
            { op: "add_index", name: "by_title", columns: ["title"], unique: true },
        ]);
    });

    it("builds a new table with its primary key", () => {
        const table = newTable({ database: "shop", schema: "public", table: "neu" }, [
            idColumn("postgres"),
            { ...newColumn("postgres"), name: "name ", nullable: false },
        ]);
        expect(table.primaryKey).toEqual(["id"]);
        expect(table.columns.map((column) => column.name)).toEqual(["id", "name"]);
        expect(table.columns[0]?.autoIncrement).toBe(true);
    });

    it("moves columns with positions in the final order", () => {
        const three: TableDesign = {
            ...design,
            columns: [
                ...design.columns,
                { ...design.columns[1]!, name: "price", dataType: "int", collation: null },
            ],
        };
        let columns = columnRows(three);
        columns = moveRow(columns, columns[2]!.key, -2);
        expect(columns.map((row) => row.name)).toEqual(["price", "id", "label"]);
        expect(alterOps(columns, indexRows(three), [], false)).toEqual([]);
        const ops = alterOps(columns, indexRows(three), [], true);
        expect(ops).toEqual([
            {
                op: "change_column",
                name: "price",
                column: {
                    name: "price",
                    dataType: "int",
                    nullable: true,
                    default: { kind: "keep" },
                    autoIncrement: false,
                },
                position: { kind: "first" },
            },
            {
                op: "change_column",
                name: "id",
                column: {
                    name: "id",
                    dataType: "int",
                    nullable: false,
                    default: { kind: "keep" },
                    autoIncrement: true,
                },
                position: { kind: "after", column: "price" },
            },
        ]);
    });

    it("positions a new column only when existing columns follow it", () => {
        let columns = columnRows(design);
        const added = { ...newColumn("mysql"), name: "code" };
        columns.push(added);
        expect(alterOps(columns, indexRows(design), [], true)[0]).not.toHaveProperty("position");
        columns = moveRow(columns, added.key, -1);
        const ops = alterOps(columns, indexRows(design), [], true);
        expect(ops[0]).toMatchObject({
            op: "add_column",
            position: { kind: "after", column: "id" },
        });
        expect(ops).toHaveLength(2);
        expect(ops[1]).toMatchObject({
            op: "change_column",
            name: "label",
            position: { kind: "after", column: "code" },
        });
    });

    it("replaces the primary key when its columns change", () => {
        const columns = columnRows(design);
        columns[1] = { ...columns[1]!, primary: true, nullable: false };
        const ops = alterOps(columns, indexRows(design));
        expect(ops.slice(-2)).toEqual([
            { op: "drop_index", name: "PRIMARY" },
            { op: "add_primary_key", columns: ["id", "label"] },
        ]);
        columns[0] = { ...columns[0]!, primary: false };
        columns[1] = { ...columns[1]!, primary: false };
        expect(alterOps(columns, indexRows(design)).slice(-1)).toEqual([
            { op: "drop_index", name: "PRIMARY" },
        ]);
    });

    it("keeps the primary key when only a key column is renamed", () => {
        const columns = columnRows(design);
        columns[0] = { ...columns[0]!, name: "key_id" };
        expect(alterOps(columns, indexRows(design)).map((op) => op.op)).toEqual(["change_column"]);
    });

    it("sends a comment only when it changed", () => {
        const columns = columnRows(design);
        columns[1] = { ...columns[1]!, comment: " Bezeichnung " };
        const [op] = alterOps(columns, indexRows(design));
        expect(op).toMatchObject({ op: "change_column", column: { comment: "Bezeichnung" } });
        columns[1] = { ...columns[1]!, comment: "" };
        expect(alterOps(columns, indexRows(design))).toEqual([]);
    });

    it("adds and drops foreign keys", () => {
        const withKey: TableDesign = {
            ...design,
            foreignKeys: [
                {
                    name: "fk_owner",
                    columns: ["label"],
                    target: { database: "shop", schema: null, table: "owners" },
                    targetColumns: ["code"],
                    onDelete: "cascade",
                    onUpdate: "no_action",
                },
            ],
        };
        const keys = foreignKeyRows(withKey);
        expect(alterOps(columnRows(withKey), indexRows(withKey), keys)).toEqual([]);
        keys[0] = { ...keys[0]!, dropped: true };
        keys.push({
            key: "new",
            original: null,
            name: " fk_id ",
            columns: ["id"],
            targetTable: "owners",
            targetColumns: ["id"],
            onDelete: "set_null",
            onUpdate: "cascade",
            dropped: false,
        });
        expect(alterOps(columnRows(withKey), indexRows(withKey), keys)).toEqual([
            { op: "drop_foreign_key", name: "fk_owner" },
            {
                op: "add_foreign_key",
                name: "fk_id",
                columns: ["id"],
                target_table: "owners",
                target_columns: ["id"],
                on_delete: "set_null",
                on_update: "cascade",
            },
        ]);
    });
});
