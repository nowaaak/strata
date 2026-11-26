import { describe, expect, it } from "vitest";
import type { TableDesign } from "@/bindings/TableDesign";
import { alterOps, columnRows, idColumn, indexRows, newColumn, newTable } from "./model";

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
        expect(alterOps(columns, [])).toEqual([]);
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
});
