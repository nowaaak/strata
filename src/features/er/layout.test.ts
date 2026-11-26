import { describe, expect, it } from "vitest";
import type { SchemaGraph } from "@/bindings/SchemaGraph";
import { layoutSchema, visibleColumns } from "./layout";

const column = (name: string, primary = false) => ({
    name,
    dataType: "int",
    nullable: !primary,
    primary,
});

const graph: SchemaGraph = {
    tables: [
        { name: "kunden", kind: "table", columns: [column("id", true), column("name")] },
        {
            name: "bestellungen",
            kind: "table",
            columns: [column("id", true), column("kunde_id"), column("betrag")],
        },
        { name: "log", kind: "table", columns: [column("text")] },
        { name: "umsatz", kind: "view", columns: [column("summe")] },
    ],
    foreignKeys: [
        {
            name: "fk_kunde",
            table: "bestellungen",
            columns: ["kunde_id"],
            targetTable: "kunden",
            targetColumns: ["id"],
        },
    ],
    truncated: false,
};

const overlaps = (a: { x: number; y: number; width: number; height: number }, b: typeof a) =>
    a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

describe("ER layout", () => {
    it("places referenced tables left of referencing ones", () => {
        const { boxes } = layoutSchema(graph, { compact: false, onlyRelated: false });
        expect(boxes.size).toBe(4);
        expect(boxes.get("kunden")!.x).toBeLessThan(boxes.get("bestellungen")!.x);
    });

    it("puts unrelated tables below the connected part without overlaps", () => {
        const { boxes } = layoutSchema(graph, { compact: false, onlyRelated: false });
        const related = Math.max(
            boxes.get("kunden")!.y + boxes.get("kunden")!.height,
            boxes.get("bestellungen")!.y + boxes.get("bestellungen")!.height,
        );
        expect(boxes.get("log")!.y).toBeGreaterThan(related);
        const all = [...boxes.values()];
        for (const [index, box] of all.entries()) {
            for (const other of all.slice(index + 1)) {
                expect(overlaps(box, other)).toBe(false);
            }
        }
    });

    it("can hide unrelated tables and non key columns", () => {
        const { tables, boxes } = layoutSchema(graph, { compact: true, onlyRelated: true });
        expect(tables.map((table) => table.name)).toEqual(["kunden", "bestellungen"]);
        expect(boxes.has("log")).toBe(false);
        const orders = tables.find((table) => table.name === "bestellungen")!;
        expect(visibleColumns(orders, true).map((c) => c.name)).toEqual(["id", "kunde_id"]);
    });
});
