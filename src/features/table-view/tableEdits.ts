import type { Row } from "@/api/query";
import type { CellValue } from "@/bindings/CellValue";
import type { RowChange } from "@/bindings/RowChange";

export type EditState = {
    updates: Map<number, Map<number, string | null>>;
    keys: Map<number, CellValue[]>;
    deleted: Set<number>;
    inserted: (string | null | undefined)[][];
};

export type EditContext = {
    rowCount: number;
    columnNames: string[];
    keyColumns: number[];
    original: (row: number) => Row | undefined;
};

export function emptyEdits(): EditState {
    return { updates: new Map(), keys: new Map(), deleted: new Set(), inserted: [] };
}

function keyCells(context: EditContext, original: Row): CellValue[] {
    return context.keyColumns.map((index) => ({
        column: context.columnNames[index] ?? "",
        value: original[index] ?? null,
    }));
}

export function editCell(
    state: EditState,
    context: EditContext,
    row: number,
    col: number,
    value: string | null,
): EditState {
    if (row >= context.rowCount) {
        const inserted = state.inserted.map((cells) => [...cells]);
        const cells = inserted[row - context.rowCount];
        if (!cells) {
            return state;
        }
        cells[col] = value;
        return { ...state, inserted };
    }
    const original = context.original(row);
    if (!original || state.deleted.has(row)) {
        return state;
    }
    const updates = new Map(state.updates);
    const cells = new Map(updates.get(row) ?? []);
    if ((original[col] ?? null) === value) {
        cells.delete(col);
    } else {
        cells.set(col, value);
    }
    const keys = new Map(state.keys);
    if (cells.size === 0) {
        updates.delete(row);
        keys.delete(row);
    } else {
        updates.set(row, cells);
        if (!keys.has(row)) {
            keys.set(row, keyCells(context, original));
        }
    }
    return { ...state, updates, keys };
}

export function deleteRows(state: EditState, context: EditContext, rows: number[]): EditState {
    const deleted = new Set(state.deleted);
    const updates = new Map(state.updates);
    const keys = new Map(state.keys);
    const removeInserted = new Set<number>();
    for (const row of rows) {
        if (row >= context.rowCount) {
            removeInserted.add(row - context.rowCount);
            continue;
        }
        const original = context.original(row);
        if (!original) {
            continue;
        }
        deleted.add(row);
        updates.delete(row);
        if (!keys.has(row)) {
            keys.set(row, keyCells(context, original));
        }
    }
    const inserted = state.inserted.filter((_, index) => !removeInserted.has(index));
    return { updates, keys, deleted, inserted };
}

export function addRow(state: EditState, columnCount: number): EditState {
    return {
        ...state,
        inserted: [...state.inserted, Array.from({ length: columnCount }, () => undefined)],
    };
}

export function changeCount(state: EditState): number {
    let updates = 0;
    for (const row of state.updates.keys()) {
        if (!state.deleted.has(row)) {
            updates += 1;
        }
    }
    return state.deleted.size + updates + state.inserted.length;
}

export function buildChanges(state: EditState, columnNames: string[]): RowChange[] {
    const changes: RowChange[] = [];
    for (const row of [...state.deleted].sort((a, b) => a - b)) {
        changes.push({ type: "delete", key: state.keys.get(row) ?? [] });
    }
    for (const [row, cells] of [...state.updates].sort(([a], [b]) => a - b)) {
        if (state.deleted.has(row)) {
            continue;
        }
        changes.push({
            type: "update",
            key: state.keys.get(row) ?? [],
            values: [...cells].map(([col, value]) => ({ column: columnNames[col] ?? "", value })),
        });
    }
    for (const cells of state.inserted) {
        changes.push({
            type: "insert",
            values: cells.flatMap((value, col) =>
                value === undefined ? [] : [{ column: columnNames[col] ?? "", value }],
            ),
        });
    }
    return changes;
}
