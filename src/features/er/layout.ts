import { Graph, layout } from "@dagrejs/dagre";
import type { GraphTable } from "@/bindings/GraphTable";
import type { SchemaGraph } from "@/bindings/SchemaGraph";

export const HEADER_HEIGHT = 34;
export const ROW_HEIGHT = 22;
const PADDING = 8;
const GAP = 48;

export type Box = { x: number; y: number; width: number; height: number };

export type ErOptions = { compact: boolean; onlyRelated: boolean };

export type ErTable = GraphTable & { foreignColumns: Set<string> };

export type ErLayout = { tables: ErTable[]; boxes: Map<string, Box> };

export function visibleColumns(table: ErTable, compact: boolean) {
    return compact
        ? table.columns.filter((column) => column.primary || table.foreignColumns.has(column.name))
        : table.columns;
}

function size(table: ErTable, compact: boolean): { width: number; height: number } {
    const columns = visibleColumns(table, compact);
    const longest = Math.max(
        table.name.length * 8.5 + 56,
        ...columns.map((column) => (column.name.length + column.dataType.length) * 7.5 + 84),
    );
    return {
        width: Math.min(400, Math.max(180, Math.ceil(longest))),
        height: HEADER_HEIGHT + columns.length * ROW_HEIGHT + PADDING,
    };
}

export function erTables(graph: SchemaGraph, onlyRelated: boolean): ErTable[] {
    const foreign = new Map<string, Set<string>>();
    const related = new Set<string>();
    for (const key of graph.foreignKeys) {
        const columns = foreign.get(key.table) ?? new Set<string>();
        key.columns.forEach((column) => columns.add(column));
        foreign.set(key.table, columns);
        related.add(key.table);
        related.add(key.targetTable);
    }
    return graph.tables
        .filter((table) => !onlyRelated || related.has(table.name))
        .map((table) => ({ ...table, foreignColumns: foreign.get(table.name) ?? new Set() }));
}

export function layoutSchema(graph: SchemaGraph, options: ErOptions): ErLayout {
    const tables = erTables(graph, options.onlyRelated);
    const names = new Set(tables.map((table) => table.name));
    const keys = graph.foreignKeys.filter(
        (key) => names.has(key.table) && names.has(key.targetTable),
    );
    const connected = new Set(keys.flatMap((key) => [key.table, key.targetTable]));
    const sizes = new Map(tables.map((table) => [table.name, size(table, options.compact)]));
    const boxes = new Map<string, Box>();

    let bottom = 0;
    if (connected.size > 0) {
        const g = new Graph({ multigraph: true });
        g.setGraph({ rankdir: "LR", nodesep: 36, ranksep: 110, marginx: 0, marginy: 0 });
        g.setDefaultEdgeLabel(() => ({}));
        for (const name of connected) {
            g.setNode(name, { ...sizes.get(name)! });
        }
        for (const key of keys) {
            if (key.table !== key.targetTable) {
                g.setEdge(key.targetTable, key.table, {}, `${key.table}.${key.name}`);
            }
        }
        layout(g);
        for (const name of connected) {
            const node = g.node(name);
            const { width, height } = sizes.get(name)!;
            const box = { x: node.x - width / 2, y: node.y - height / 2, width, height };
            boxes.set(name, box);
            bottom = Math.max(bottom, box.y + box.height);
        }
    }

    const loose = tables.filter((table) => !connected.has(table.name));
    const perRow = Math.max(1, Math.ceil(Math.sqrt(loose.length * 1.5)));
    let x = 0;
    let y = connected.size > 0 ? bottom + GAP * 2 : 0;
    let rowHeight = 0;
    loose.forEach((table, index) => {
        if (index > 0 && index % perRow === 0) {
            x = 0;
            y += rowHeight + GAP;
            rowHeight = 0;
        }
        const { width, height } = sizes.get(table.name)!;
        boxes.set(table.name, { x, y, width, height });
        x += width + GAP;
        rowHeight = Math.max(rowHeight, height);
    });

    return { tables, boxes };
}
