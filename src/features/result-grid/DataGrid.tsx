import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDownIcon, ArrowUpIcon } from "lucide-react";
import {
    useEffect,
    useRef,
    useState,
    useSyncExternalStore,
    type KeyboardEvent,
    type MouseEvent,
} from "react";
import { toast } from "sonner";
import type { ColumnMeta } from "@/bindings/ColumnMeta";
import type { SortSpec } from "@/bindings/SortSpec";
import {
    ContextMenu,
    ContextMenuContent,
    ContextMenuItem,
    ContextMenuSeparator,
    ContextMenuShortcut,
    ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { ROW_HEIGHTS } from "@/features/settings/theme";
import { useSettings } from "@/features/settings/useSettings";
import { useT } from "@/i18n";
import { cn } from "@/lib/utils";
import {
    contentWidth,
    displayText,
    formatCount,
    initialWidth,
    isRightAligned,
    toTsv,
} from "./format";
import type { RowCache } from "./rowCache";

const HEADER_HEIGHT = 34;
const COPY_LIMIT = 100_000;

export type CellPos = { row: number; col: number };
type Selection = { anchor: CellPos; focus: CellPos };
type Bounds = { r0: number; r1: number; c0: number; c1: number };

export type GridEdits = {
    updates: ReadonlyMap<number, ReadonlyMap<number, string | null>>;
    deleted: ReadonlySet<number>;
    inserted: readonly (readonly (string | null | undefined)[])[];
};

export type GridEditor = {
    edits: GridEdits;
    canEdit: (col: number) => boolean;
    onEdit: (row: number, col: number, value: string | null) => void;
    onDeleteRows: (rows: number[]) => void;
    onOpenEditor: (row: number, col: number, value: string | null) => void;
};

type DataGridProps = {
    label: string;
    columns: ColumnMeta[];
    rowCount: number;
    cache: RowCache;
    sort?: SortSpec | null;
    onSort?: (column: string) => void;
    editor?: GridEditor | null;
};

function bounds(selection: Selection): Bounds {
    return {
        r0: Math.min(selection.anchor.row, selection.focus.row),
        r1: Math.max(selection.anchor.row, selection.focus.row),
        c0: Math.min(selection.anchor.col, selection.focus.col),
        c1: Math.max(selection.anchor.col, selection.focus.col),
    };
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

export function DataGrid({ label, columns, rowCount, cache, sort, onSort, editor }: DataGridProps) {
    const t = useT();
    const rowHeight = ROW_HEIGHTS[useSettings().data?.gridDensity ?? "normal"];
    const scrollRef = useRef<HTMLDivElement>(null);
    const dragging = useRef<"cells" | "rows" | null>(null);
    const [widths, setWidths] = useState(() => columns.map(initialWidth));
    const [selection, setSelection] = useState<Selection | null>(null);
    const [editing, setEditing] = useState<(CellPos & { value: string }) | null>(null);
    useSyncExternalStore(cache.subscribe, cache.getVersion);

    const inserted = editor?.edits.inserted ?? [];
    const totalRows = rowCount + inserted.length;
    const gutter = Math.max(48, String(totalRows).length * 8 + 24);
    const totalWidth = gutter + widths.reduce((sum, width) => sum + width, 0);

    const rowVirtualizer = useVirtualizer({
        count: totalRows,
        getScrollElement: () => scrollRef.current,
        estimateSize: () => rowHeight,
        overscan: 12,
        paddingStart: HEADER_HEIGHT,
        scrollPaddingStart: HEADER_HEIGHT,
    });
    const columnVirtualizer = useVirtualizer({
        horizontal: true,
        count: columns.length,
        getScrollElement: () => scrollRef.current,
        estimateSize: (index) => widths[index] ?? 120,
        overscan: 4,
        paddingStart: gutter,
        scrollPaddingStart: gutter,
    });

    useEffect(() => {
        columnVirtualizer.measure();
    }, [widths, gutter, columnVirtualizer]);

    useEffect(() => {
        rowVirtualizer.measure();
    }, [rowHeight, rowVirtualizer]);

    const virtualRows = rowVirtualizer.getVirtualItems();
    const virtualColumns = columnVirtualizer.getVirtualItems();
    const firstRow = virtualRows[0]?.index ?? 0;
    const lastRow = virtualRows.at(-1)?.index ?? 0;

    useEffect(() => {
        cache.ensure(firstRow, lastRow, rowCount);
    }, [cache, firstRow, lastRow, rowCount]);

    useEffect(() => {
        const stop = () => {
            dragging.current = null;
        };
        window.addEventListener("mouseup", stop);
        return () => window.removeEventListener("mouseup", stop);
    }, []);

    const valueAt = (row: number, col: number): string | null | undefined => {
        if (row >= rowCount) {
            return inserted[row - rowCount]?.[col];
        }
        const update = editor?.edits.updates.get(row);
        if (update?.has(col)) {
            return update.get(col) ?? null;
        }
        const data = cache.row(row);
        return data ? (data[col] ?? null) : undefined;
    };

    const range = selection ? bounds(selection) : null;
    const isSelected = (row: number, col: number) =>
        range !== null && row >= range.r0 && row <= range.r1 && col >= range.c0 && col <= range.c1;

    const focusGrid = () => scrollRef.current?.focus({ preventScroll: true });

    const reveal = (cell: CellPos) => {
        rowVirtualizer.scrollToIndex(cell.row, { align: "auto" });
        columnVirtualizer.scrollToIndex(cell.col, { align: "auto" });
    };

    const startEdit = (cell: CellPos) => {
        if (!editor || !editor.canEdit(cell.col)) {
            return;
        }
        if (cell.row < rowCount && editor.edits.deleted.has(cell.row)) {
            return;
        }
        const current = valueAt(cell.row, cell.col);
        if (current === undefined && cell.row < rowCount) {
            return;
        }
        const text = current ?? "";
        if (text.includes("\n") || text.length > 200) {
            editor.onOpenEditor(cell.row, cell.col, current ?? null);
            return;
        }
        setEditing({ ...cell, value: text });
    };

    const commitEdit = (move?: CellPos) => {
        if (!editing || !editor) {
            return;
        }
        const original = valueAt(editing.row, editing.col);
        if (original !== editing.value) {
            editor.onEdit(editing.row, editing.col, editing.value);
        }
        setEditing(null);
        if (move) {
            setSelection({ anchor: move, focus: move });
            reveal(move);
        }
        focusGrid();
    };

    const copy = async (withHeader: boolean) => {
        if (!range || columns.length === 0) {
            return;
        }
        const count = range.r1 - range.r0 + 1;
        if (count > COPY_LIMIT) {
            toast.error(t.grid.tooLarge, {
                description: t.grid.tooLargeDescription(formatCount(COPY_LIMIT)),
            });
            return;
        }
        try {
            const realEnd = Math.min(range.r1, rowCount - 1);
            const fetched = range.r0 <= realEnd ? await cache.rows(range.r0, realEnd) : [];
            const rows: (string | null | undefined)[][] = [];
            for (let row = range.r0; row <= range.r1; row += 1) {
                const cells: (string | null | undefined)[] = [];
                for (let col = range.c0; col <= range.c1; col += 1) {
                    if (row >= rowCount) {
                        cells.push(inserted[row - rowCount]?.[col]);
                        continue;
                    }
                    const update = editor?.edits.updates.get(row);
                    cells.push(
                        update?.has(col)
                            ? update.get(col)
                            : (fetched[row - range.r0]?.[col] ?? null),
                    );
                }
                rows.push(cells);
            }
            const header = withHeader
                ? columns.slice(range.c0, range.c1 + 1).map((column) => column.name)
                : null;
            await navigator.clipboard.writeText(toTsv(header, rows));
            if (count > 1) {
                toast.success(t.grid.copiedRows(formatCount(count)));
            }
        } catch (error) {
            toast.error(t.common.copyFailed, {
                description: error instanceof Error ? error.message : String(error),
            });
        }
    };

    const fullRows = range !== null && range.c0 === 0 && range.c1 === columns.length - 1;
    const selectedRows = () => {
        if (!range) {
            return [];
        }
        const rows: number[] = [];
        for (let row = range.r0; row <= range.r1; row += 1) {
            rows.push(row);
        }
        return rows;
    };

    const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        if (editing || totalRows === 0 || columns.length === 0) {
            return;
        }
        const ctrl = event.ctrlKey || event.metaKey;
        const key = event.key;
        if (ctrl && key.toLowerCase() === "c") {
            event.preventDefault();
            void copy(event.shiftKey);
            return;
        }
        if (ctrl && key.toLowerCase() === "a") {
            event.preventDefault();
            setSelection({
                anchor: { row: 0, col: 0 },
                focus: { row: totalRows - 1, col: columns.length - 1 },
            });
            return;
        }
        const focus = selection?.focus ?? { row: 0, col: 0 };
        if ((key === "Enter" || key === "F2") && selection) {
            event.preventDefault();
            startEdit(focus);
            return;
        }
        if (key === "Delete" && editor && fullRows) {
            event.preventDefault();
            editor.onDeleteRows(selectedRows());
            return;
        }
        const page = Math.max(
            1,
            Math.floor((scrollRef.current?.clientHeight ?? 300) / rowHeight) - 2,
        );
        let next: CellPos;
        switch (key) {
            case "ArrowUp":
                next = { row: focus.row - 1, col: focus.col };
                break;
            case "ArrowDown":
                next = { row: focus.row + 1, col: focus.col };
                break;
            case "ArrowLeft":
                next = { row: focus.row, col: focus.col - 1 };
                break;
            case "ArrowRight":
            case "Tab":
                next = {
                    row: focus.row,
                    col: focus.col + (event.shiftKey && key === "Tab" ? -1 : 1),
                };
                break;
            case "PageUp":
                next = { row: focus.row - page, col: focus.col };
                break;
            case "PageDown":
                next = { row: focus.row + page, col: focus.col };
                break;
            case "Home":
                next = ctrl ? { row: 0, col: 0 } : { row: focus.row, col: 0 };
                break;
            case "End":
                next = ctrl
                    ? { row: totalRows - 1, col: columns.length - 1 }
                    : { row: focus.row, col: columns.length - 1 };
                break;
            default:
                return;
        }
        event.preventDefault();
        const cell = {
            row: clamp(next.row, 0, totalRows - 1),
            col: clamp(next.col, 0, columns.length - 1),
        };
        const extend = event.shiftKey && key !== "Tab" && selection !== null;
        setSelection(
            extend ? { anchor: selection.anchor, focus: cell } : { anchor: cell, focus: cell },
        );
        reveal(cell);
    };

    const onCellMouseDown = (event: MouseEvent, cell: CellPos) => {
        if (event.button !== 0) {
            return;
        }
        if (editing) {
            commitEdit();
        }
        focusGrid();
        dragging.current = "cells";
        setSelection((current) =>
            event.shiftKey && current
                ? { anchor: current.anchor, focus: cell }
                : { anchor: cell, focus: cell },
        );
    };

    const onRowHeaderMouseDown = (event: MouseEvent, row: number) => {
        if (event.button !== 0) {
            return;
        }
        focusGrid();
        dragging.current = "rows";
        const last = columns.length - 1;
        setSelection((current) =>
            event.shiftKey && current
                ? { anchor: { row: current.anchor.row, col: 0 }, focus: { row, col: last } }
                : { anchor: { row, col: 0 }, focus: { row, col: last } },
        );
    };

    const onCellEnter = (cell: CellPos) => {
        const mode = dragging.current;
        if (!mode) {
            return;
        }
        const focus = mode === "rows" ? { row: cell.row, col: columns.length - 1 } : cell;
        setSelection((current) => (current ? { ...current, focus } : current));
    };

    const onContextMenu = (cell: CellPos) => {
        if (!isSelected(cell.row, cell.col)) {
            setSelection({ anchor: cell, focus: cell });
        }
    };

    const startResize = (event: MouseEvent, col: number) => {
        event.preventDefault();
        event.stopPropagation();
        const startX = event.clientX;
        const startWidth = widths[col] ?? 120;
        const move = (moveEvent: globalThis.MouseEvent) => {
            const width = Math.max(48, startWidth + moveEvent.clientX - startX);
            setWidths((current) => current.map((value, index) => (index === col ? width : value)));
        };
        const up = () => {
            window.removeEventListener("mousemove", move);
            window.removeEventListener("mouseup", up);
        };
        window.addEventListener("mousemove", move);
        window.addEventListener("mouseup", up);
    };

    const autoFit = (col: number) => {
        const values: (string | null | undefined)[] = [];
        for (let row = firstRow; row <= lastRow; row += 1) {
            values.push(valueAt(row, col));
        }
        const width = contentWidth(values, columns[col]?.name ?? "");
        setWidths((current) => current.map((value, index) => (index === col ? width : value)));
    };

    const canEditFocus =
        editor !== null &&
        editor !== undefined &&
        selection !== null &&
        editor.canEdit(selection.focus.col);

    return (
        <ContextMenu>
            <ContextMenuTrigger asChild>
                <div
                    ref={scrollRef}
                    role="grid"
                    aria-label={label}
                    aria-rowcount={totalRows + 1}
                    aria-colcount={columns.length}
                    aria-multiselectable
                    tabIndex={0}
                    onKeyDown={onKeyDown}
                    className="relative h-full overflow-auto text-[12.5px] outline-none [scrollbar-gutter:stable]"
                >
                    <div
                        style={{ height: rowVirtualizer.getTotalSize(), width: totalWidth }}
                        className="relative"
                    >
                        <div
                            role="row"
                            aria-rowindex={1}
                            className="sticky top-0 z-20 flex border-b border-border bg-muted"
                            style={{ height: HEADER_HEIGHT, width: totalWidth }}
                        >
                            <div
                                className="sticky left-0 z-30 shrink-0 border-r border-border bg-muted"
                                style={{ width: gutter }}
                            />
                            {virtualColumns.map((virtualColumn) => {
                                const column = columns[virtualColumn.index];
                                if (!column) {
                                    return null;
                                }
                                const sorted = sort?.column === column.name ? sort : null;
                                return (
                                    <div
                                        key={virtualColumn.key}
                                        role="columnheader"
                                        aria-colindex={virtualColumn.index + 1}
                                        aria-sort={
                                            sorted
                                                ? sorted.descending
                                                    ? "descending"
                                                    : "ascending"
                                                : undefined
                                        }
                                        title={`${column.name}${column.typeName ? ` (${column.typeName})` : ""}`}
                                        onClick={() => onSort?.(column.name)}
                                        className={cn(
                                            "absolute top-0 flex h-full items-center gap-1.5 border-r border-border px-2 font-medium",
                                            onSort && "cursor-pointer hover:bg-accent/60",
                                        )}
                                        style={{
                                            left: virtualColumn.start,
                                            width: virtualColumn.size,
                                        }}
                                    >
                                        <span className="truncate">{column.name}</span>
                                        {column.typeName && (
                                            <span className="truncate text-[11px] font-normal text-muted-foreground">
                                                {column.typeName}
                                            </span>
                                        )}
                                        {sorted &&
                                            (sorted.descending ? (
                                                <ArrowDownIcon className="ml-auto size-3.5 shrink-0 text-primary" />
                                            ) : (
                                                <ArrowUpIcon className="ml-auto size-3.5 shrink-0 text-primary" />
                                            ))}
                                        <span
                                            aria-hidden
                                            onMouseDown={(event) =>
                                                startResize(event, virtualColumn.index)
                                            }
                                            onClick={(event) => event.stopPropagation()}
                                            onDoubleClick={(event) => {
                                                event.stopPropagation();
                                                autoFit(virtualColumn.index);
                                            }}
                                            className="absolute top-0 -right-1 z-10 h-full w-2 cursor-col-resize hover:bg-primary/40"
                                        />
                                    </div>
                                );
                            })}
                        </div>
                        {virtualRows.map((virtualRow) => {
                            const row = virtualRow.index;
                            const isInserted = row >= rowCount;
                            const isDeleted =
                                !isInserted && (editor?.edits.deleted.has(row) ?? false);
                            const rowSelected =
                                range !== null && row >= range.r0 && row <= range.r1;
                            return (
                                <div
                                    key={virtualRow.key}
                                    role="row"
                                    aria-rowindex={row + 2}
                                    className={cn(
                                        "absolute left-0 flex",
                                        isInserted && "bg-emerald-500/10",
                                        isDeleted &&
                                            "bg-destructive/10 text-muted-foreground line-through",
                                    )}
                                    style={{
                                        top: virtualRow.start,
                                        height: rowHeight,
                                        width: totalWidth,
                                    }}
                                >
                                    <div
                                        role="rowheader"
                                        onMouseDown={(event) => onRowHeaderMouseDown(event, row)}
                                        onMouseEnter={() => onCellEnter({ row, col: 0 })}
                                        className={cn(
                                            "sticky left-0 z-10 flex shrink-0 cursor-default items-center justify-end border-r border-b border-border bg-background pr-2 text-[11px] text-muted-foreground tabular-nums",
                                            rowSelected && "bg-accent text-foreground",
                                        )}
                                        style={{ width: gutter }}
                                    >
                                        {isInserted ? "+" : formatCount(row + 1)}
                                    </div>
                                    <div className="relative flex-1">
                                        {virtualColumns.map((virtualColumn) => {
                                            const col = virtualColumn.index;
                                            const column = columns[col];
                                            if (!column) {
                                                return null;
                                            }
                                            const value = valueAt(row, col);
                                            const selected = isSelected(row, col);
                                            const focused =
                                                selection?.focus.row === row &&
                                                selection.focus.col === col;
                                            const changed =
                                                !isInserted &&
                                                (editor?.edits.updates.get(row)?.has(col) ?? false);
                                            const isEditing =
                                                editing?.row === row && editing.col === col;
                                            return (
                                                <div
                                                    key={virtualColumn.key}
                                                    role="gridcell"
                                                    aria-colindex={col + 1}
                                                    aria-selected={selected}
                                                    onMouseDown={(event) =>
                                                        onCellMouseDown(event, { row, col })
                                                    }
                                                    onMouseEnter={() => onCellEnter({ row, col })}
                                                    onDoubleClick={() => startEdit({ row, col })}
                                                    onContextMenu={() =>
                                                        onContextMenu({ row, col })
                                                    }
                                                    className={cn(
                                                        "absolute top-0 flex h-full items-center border-r border-b border-border/70 px-2",
                                                        isRightAligned(column.kind) &&
                                                            "justify-end tabular-nums",
                                                        column.kind === "temporal" &&
                                                            "tabular-nums",
                                                        column.kind === "binary" &&
                                                            "font-mono text-[11.5px] text-muted-foreground",
                                                        changed && "bg-amber-500/15",
                                                        selected && "bg-primary/15",
                                                        focused && "ring-1 ring-primary ring-inset",
                                                    )}
                                                    style={{
                                                        left: virtualColumn.start - gutter,
                                                        width: virtualColumn.size,
                                                    }}
                                                >
                                                    {isEditing ? (
                                                        <input
                                                            autoFocus
                                                            aria-label={t.grid.editCell(
                                                                column.name,
                                                            )}
                                                            value={editing.value}
                                                            onChange={(event) =>
                                                                setEditing({
                                                                    ...editing,
                                                                    value: event.target.value,
                                                                })
                                                            }
                                                            onMouseDown={(event) =>
                                                                event.stopPropagation()
                                                            }
                                                            onBlur={() => commitEdit()}
                                                            onKeyDown={(event) => {
                                                                event.stopPropagation();
                                                                if (event.key === "Enter") {
                                                                    event.preventDefault();
                                                                    commitEdit({
                                                                        row: clamp(
                                                                            row + 1,
                                                                            0,
                                                                            totalRows - 1,
                                                                        ),
                                                                        col,
                                                                    });
                                                                } else if (event.key === "Escape") {
                                                                    event.preventDefault();
                                                                    setEditing(null);
                                                                    focusGrid();
                                                                } else if (event.key === "Tab") {
                                                                    event.preventDefault();
                                                                    commitEdit({
                                                                        row,
                                                                        col: clamp(
                                                                            col +
                                                                                (event.shiftKey
                                                                                    ? -1
                                                                                    : 1),
                                                                            0,
                                                                            columns.length - 1,
                                                                        ),
                                                                    });
                                                                }
                                                            }}
                                                            className="h-full w-full bg-background px-1 font-sans text-[12.5px] text-foreground outline-none"
                                                        />
                                                    ) : value === null ? (
                                                        <span className="text-muted-foreground/70 italic">
                                                            NULL
                                                        </span>
                                                    ) : value === undefined ? (
                                                        <span className="text-muted-foreground/50">
                                                            {isInserted ? "DEFAULT" : "…"}
                                                        </span>
                                                    ) : (
                                                        <span className="truncate">
                                                            {displayText(value, column.kind)}
                                                        </span>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </ContextMenuTrigger>
            <ContextMenuContent className="w-60">
                <ContextMenuItem disabled={!range} onSelect={() => void copy(false)}>
                    {t.grid.copy}
                    <ContextMenuShortcut>{t.grid.keys.copy}</ContextMenuShortcut>
                </ContextMenuItem>
                <ContextMenuItem disabled={!range} onSelect={() => void copy(true)}>
                    {t.grid.copyWithHeaders}
                    <ContextMenuShortcut>{t.grid.keys.copyWithHeaders}</ContextMenuShortcut>
                </ContextMenuItem>
                {editor && (
                    <>
                        <ContextMenuSeparator />
                        <ContextMenuItem
                            disabled={!canEditFocus}
                            onSelect={() => selection && startEdit(selection.focus)}
                        >
                            {t.grid.edit}
                            <ContextMenuShortcut>{t.grid.keys.edit}</ContextMenuShortcut>
                        </ContextMenuItem>
                        <ContextMenuItem
                            disabled={!canEditFocus}
                            onSelect={() => {
                                if (selection) {
                                    const value = valueAt(selection.focus.row, selection.focus.col);
                                    editor.onOpenEditor(
                                        selection.focus.row,
                                        selection.focus.col,
                                        value ?? null,
                                    );
                                }
                            }}
                        >
                            {t.grid.editInEditor}
                        </ContextMenuItem>
                        <ContextMenuItem
                            disabled={!canEditFocus}
                            onSelect={() =>
                                selection &&
                                editor.onEdit(selection.focus.row, selection.focus.col, null)
                            }
                        >
                            {t.grid.setNull}
                        </ContextMenuItem>
                        <ContextMenuSeparator />
                        <ContextMenuItem
                            variant="destructive"
                            disabled={!range}
                            onSelect={() => editor.onDeleteRows(selectedRows())}
                        >
                            {range && range.r1 > range.r0 ? t.grid.deleteRows : t.grid.deleteRow}
                            <ContextMenuShortcut>{t.grid.keys.delete}</ContextMenuShortcut>
                        </ContextMenuItem>
                    </>
                )}
            </ContextMenuContent>
        </ContextMenu>
    );
}
