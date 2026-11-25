import type { Row } from "@/api/query";
import {
    addRow,
    buildChanges,
    changeCount,
    deleteRows,
    editCell,
    emptyEdits,
    type EditContext,
} from "./tableEdits";

const rows: Row[] = [
    ["1", "Anna", null],
    ["2", "Ben", "x"],
];

const context: EditContext = {
    rowCount: rows.length,
    columnNames: ["id", "name", "note"],
    keyColumns: [0],
    original: (row) => rows[row],
};

describe("table edits", () => {
    it("records updates with the original key and drops edits that restore the value", () => {
        let state = editCell(emptyEdits(), context, 0, 1, "Anne");
        state = editCell(state, context, 0, 0, "10");
        expect(buildChanges(state, context.columnNames)).toEqual([
            {
                type: "update",
                key: [{ column: "id", value: "1" }],
                values: [
                    { column: "name", value: "Anne" },
                    { column: "id", value: "10" },
                ],
            },
        ]);
        state = editCell(state, context, 0, 1, "Anna");
        state = editCell(state, context, 0, 0, "1");
        expect(changeCount(state)).toBe(0);
        expect(state.keys.size).toBe(0);
    });

    it("distinguishes NULL from an empty string", () => {
        const state = editCell(emptyEdits(), context, 0, 2, "");
        expect(buildChanges(state, context.columnNames)[0]).toMatchObject({
            values: [{ column: "note", value: "" }],
        });
        expect(changeCount(editCell(emptyEdits(), context, 0, 2, null))).toBe(0);
    });

    it("deletes rows, discards their updates and removes unsaved inserts", () => {
        let state = editCell(emptyEdits(), context, 1, 1, "Benno");
        state = addRow(state, 3);
        state = editCell(state, context, 2, 1, "Neu");
        state = addRow(state, 3);
        state = deleteRows(state, context, [1, 3]);
        expect(buildChanges(state, context.columnNames)).toEqual([
            { type: "delete", key: [{ column: "id", value: "2" }] },
            { type: "insert", values: [{ column: "name", value: "Neu" }] },
        ]);
        expect(changeCount(state)).toBe(2);
    });

    it("ignores edits on rows that are not loaded or already deleted", () => {
        const deleted = deleteRows(emptyEdits(), context, [0]);
        expect(editCell(deleted, context, 0, 1, "x")).toBe(deleted);
        const unknown = editCell(
            emptyEdits(),
            { ...context, original: () => undefined },
            0,
            1,
            "x",
        );
        expect(changeCount(unknown)).toBe(0);
    });
});
