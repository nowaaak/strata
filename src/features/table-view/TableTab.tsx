import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
    FilterIcon,
    Loader2Icon,
    LockIcon,
    PlusIcon,
    RefreshCwIcon,
    SaveIcon,
    Undo2Icon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { applyChanges, previewChanges } from "@/api/edit";
import { errorMessage } from "@/api/invoke";
import { describeTable, tableDdl } from "@/api/schema";
import type { SortSpec } from "@/bindings/SortSpec";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { SqlEditor } from "@/features/query-editor/SqlEditor";
import { DataGrid, type GridEditor } from "@/features/result-grid/DataGrid";
import { ExportMenu } from "@/features/result-grid/ExportMenu";
import { formatCount } from "@/features/result-grid/format";
import { RunStatus } from "@/features/result-grid/ResultPanel";
import { firstError } from "@/features/result-grid/runState";
import { cancelRun, runTable, useRuns } from "@/features/result-grid/runStore";
import { useResultCache } from "@/features/result-grid/useResultCache";
import { DEFAULT_SETTINGS, ROW_LIMITS, withOption } from "@/features/settings/theme";
import { useSettings } from "@/features/settings/useSettings";
import { useWorkspace, type TableTab as TableTabModel } from "@/features/workspace/workspaceStore";
import { useT } from "@/i18n";
import { cn } from "@/lib/utils";
import { CellDialog, type CellDialogState } from "./CellDialog";
import { StructureView } from "./StructureView";
import {
    addRow,
    buildChanges,
    changeCount,
    deleteRows,
    editCell,
    emptyEdits,
    type EditContext,
} from "./tableEdits";

type View = "data" | "structure" | "ddl";
const VIEWS: View[] = ["data", "structure", "ddl"];

export function TableTab({ tab }: { tab: TableTabModel }) {
    const t = useT();
    const text = t.table;
    const queryClient = useQueryClient();
    const session = useWorkspace((state) => state.sessions[tab.sessionId]);
    const defaultLimit = useSettings().data?.defaultRowLimit ?? DEFAULT_SETTINGS.defaultRowLimit;
    const [view, setView] = useState<View>("data");
    const [filterDraft, setFilterDraft] = useState("");
    const [filter, setFilter] = useState<string | null>(null);
    const [sort, setSort] = useState<SortSpec | null>(null);
    const [limit, setLimit] = useState(defaultLimit);
    const [reloadToken, setReloadToken] = useState(0);
    const [edits, setEdits] = useState(emptyEdits);
    const [review, setReview] = useState<string[] | null>(null);
    const [saving, setSaving] = useState(false);
    const [cellDialog, setCellDialog] = useState<CellDialogState | null>(null);

    const info = useQuery({
        queryKey: ["table-info", tab.sessionId, tab.target],
        queryFn: () => describeTable(tab.sessionId, tab.target),
        staleTime: 60_000,
    });
    const ddl = useQuery({
        queryKey: ["ddl", tab.sessionId, tab.target],
        queryFn: () => tableDdl(tab.sessionId, tab.target),
        staleTime: 60_000,
        enabled: view === "ddl",
    });
    const run = useRuns((state) => state.runs[tab.id]);
    const result = run?.results.find((entry) => entry.result === run.selected);
    const cache = useResultCache(tab.sessionId, tab.id, run?.runId, result?.result);

    useEffect(() => {
        void runTable(tab.sessionId, tab.id, tab.target, { filter, sort, limit });
    }, [tab.sessionId, tab.id, tab.target, filter, sort, limit, reloadToken]);

    const columns = result?.columns ?? [];
    const columnNames = columns.map((column) => column.name);
    const keyColumns = (info.data?.editableKey ?? []).map((name) => columnNames.indexOf(name));
    const readOnlyReason = session?.readOnly
        ? text.reasons.connection
        : info.data && !info.data.editableKey
          ? text.reasons.noKey
          : keyColumns.includes(-1)
            ? text.reasons.keyMissing
            : null;
    const editable = Boolean(result && cache && info.data && !readOnlyReason && !run?.running);
    const pending = changeCount(edits);
    const dirty = pending > 0;
    const rowCount = result?.rows ?? 0;

    const context: EditContext = {
        rowCount,
        columnNames,
        keyColumns,
        original: (row) => cache?.row(row),
    };

    const guard = (action: () => void) => {
        if (dirty) {
            toast.info(text.finishFirst);
            return;
        }
        action();
    };

    const editor: GridEditor | null = editable
        ? {
              edits,
              canEdit: (col) => columns[col]?.kind !== "binary",
              onEdit: (row, col, value) =>
                  setEdits((state) => editCell(state, context, row, col, value)),
              onDeleteRows: (rows) => setEdits((state) => deleteRows(state, context, rows)),
              onOpenEditor: (row, col, value) =>
                  setCellDialog({ row, col, column: columnNames[col] ?? "", value }),
          }
        : null;

    const openReview = async () => {
        try {
            setReview(
                await previewChanges(tab.sessionId, tab.target, buildChanges(edits, columnNames)),
            );
        } catch (error) {
            toast.error(text.cannotSave, { description: errorMessage(error) });
        }
    };

    const save = async () => {
        setSaving(true);
        try {
            const count = await applyChanges(
                tab.sessionId,
                tab.id,
                tab.target,
                buildChanges(edits, columnNames),
            );
            toast.success(text.saved(formatCount(count)));
            setReview(null);
            setEdits(emptyEdits());
            setReloadToken((token) => token + 1);
            void queryClient.invalidateQueries({ queryKey: ["completion", tab.sessionId] });
        } catch (error) {
            toast.error(text.saveFailed, { description: errorMessage(error) });
        } finally {
            setSaving(false);
        }
    };

    const onSort = (column: string) =>
        guard(() =>
            setSort((current) =>
                current?.column !== column
                    ? { column, descending: false }
                    : current.descending
                      ? null
                      : { column, descending: true },
            ),
        );

    const failed = run ? firstError(run) : undefined;
    const errorText = run?.error ?? failed?.message ?? null;

    return (
        <div className="flex h-full min-h-0 flex-col">
            <div className="flex h-10 shrink-0 items-center gap-2 border-b px-2">
                <div
                    role="tablist"
                    aria-label={text.views.label}
                    className="flex rounded-lg bg-muted p-0.5"
                >
                    {VIEWS.map((entry) => (
                        <button
                            key={entry}
                            type="button"
                            role="tab"
                            aria-selected={view === entry}
                            onClick={() => setView(entry)}
                            className={cn(
                                "h-6 rounded-md px-2.5 text-xs font-medium text-muted-foreground transition-colors motion-reduce:transition-none",
                                view === entry && "bg-background text-foreground shadow-sm",
                            )}
                        >
                            {text.views[entry]}
                        </button>
                    ))}
                </div>
                {view === "data" && (
                    <>
                        <form
                            className="relative flex min-w-0 flex-1 items-center"
                            onSubmit={(event) => {
                                event.preventDefault();
                                guard(() => {
                                    const next = filterDraft.trim() === "" ? null : filterDraft;
                                    if (next === filter) {
                                        setReloadToken((token) => token + 1);
                                    } else {
                                        setFilter(next);
                                    }
                                });
                            }}
                        >
                            <FilterIcon
                                aria-hidden
                                className="pointer-events-none absolute left-2.5 size-3.5 text-muted-foreground"
                            />
                            <input
                                aria-label={text.filter}
                                placeholder={text.filterPlaceholder}
                                spellCheck={false}
                                value={filterDraft}
                                onChange={(event) => setFilterDraft(event.target.value)}
                                className="h-7 w-full min-w-0 rounded-md border border-input bg-transparent pr-2 pl-8 font-mono text-xs outline-none focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
                            />
                        </form>
                        <Select
                            value={String(limit)}
                            onValueChange={(value) => guard(() => setLimit(Number(value)))}
                        >
                            <SelectTrigger
                                size="sm"
                                aria-label={text.rowLimit}
                                className="h-7 w-32 text-xs tabular-nums"
                            >
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {withOption(ROW_LIMITS, limit).map((value) => (
                                    <SelectItem key={value} value={String(value)}>
                                        {text.rows(formatCount(value))}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <Button
                            size="icon-sm"
                            variant="ghost"
                            aria-label={text.reload}
                            title={text.reload}
                            disabled={run?.running}
                            onClick={() => guard(() => setReloadToken((token) => token + 1))}
                        >
                            <RefreshCwIcon />
                        </Button>
                        {readOnlyReason ? (
                            <span
                                className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground"
                                title={readOnlyReason}
                            >
                                <LockIcon className="size-3.5" aria-hidden />
                                {text.readOnly}
                            </span>
                        ) : (
                            <Button
                                size="sm"
                                variant="ghost"
                                disabled={!editable}
                                onClick={() => setEdits((state) => addRow(state, columns.length))}
                            >
                                <PlusIcon />
                                {text.addRow}
                            </Button>
                        )}
                        {dirty && (
                            <>
                                <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => setEdits(emptyEdits())}
                                >
                                    <Undo2Icon />
                                    {text.discard}
                                </Button>
                                <Button size="sm" onClick={() => void openReview()}>
                                    <SaveIcon />
                                    {text.review(formatCount(pending), pending === 1)}
                                </Button>
                            </>
                        )}
                    </>
                )}
            </div>

            <div className="min-h-0 flex-1">
                {view === "structure" &&
                    (info.data ? (
                        <StructureView info={info.data} />
                    ) : (
                        <p className="p-4 text-sm text-muted-foreground">
                            {info.isError ? errorMessage(info.error) : text.loadingStructure}
                        </p>
                    ))}
                {view === "ddl" &&
                    (ddl.data ? (
                        <SqlEditor
                            key={ddl.data}
                            label={text.ddlLabel(tab.target.table)}
                            initialValue={ddl.data}
                            engine={session?.engine ?? "mysql"}
                            readOnly
                        />
                    ) : (
                        <p className="p-4 text-sm text-muted-foreground">
                            {ddl.isError ? errorMessage(ddl.error) : text.loadingDdl}
                        </p>
                    ))}
                {view === "data" && (
                    <div className="flex h-full min-h-0 flex-col">
                        {errorText && (
                            <pre
                                role="alert"
                                className="border-b border-destructive/30 bg-destructive/10 px-4 py-2 font-mono text-[12px] whitespace-pre-wrap text-destructive select-text"
                            >
                                {errorText}
                            </pre>
                        )}
                        <div className="min-h-0 flex-1">
                            {result && cache ? (
                                <DataGrid
                                    key={`${run?.runId}:${result.result}`}
                                    label={text.gridLabel(tab.target.table)}
                                    columns={columns}
                                    rowCount={rowCount}
                                    cache={cache}
                                    sort={sort}
                                    onSort={onSort}
                                    editor={editor}
                                />
                            ) : run?.running ? (
                                <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
                                    <Loader2Icon
                                        className="size-4 animate-spin motion-reduce:animate-none"
                                        aria-hidden
                                    />
                                    {text.loadingData}
                                </div>
                            ) : null}
                        </div>
                    </div>
                )}
            </div>

            {view === "data" && run && (
                <footer className="flex h-8 shrink-0 items-center justify-between gap-3 border-t px-3 text-xs">
                    <RunStatus run={run} onCancel={() => cancelRun(tab.sessionId, tab.id)} />
                    {result && (
                        <span className="flex items-center gap-3 tabular-nums">
                            <span>
                                {t.query.results.size(formatCount(rowCount), columns.length)}
                            </span>
                            {result.truncated && (
                                <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-amber-700 dark:text-amber-300">
                                    {text.moreRows}
                                </span>
                            )}
                            <ExportMenu
                                sessionId={tab.sessionId}
                                tabId={tab.id}
                                result={result.result}
                                baseName={tab.target.table}
                                disabled={run.running}
                            />
                        </span>
                    )}
                </footer>
            )}

            <Dialog
                open={review !== null}
                onOpenChange={(open) => !open && !saving && setReview(null)}
            >
                <DialogContent className="sm:max-w-2xl">
                    <DialogHeader>
                        <DialogTitle>{text.reviewTitle}</DialogTitle>
                        <DialogDescription>{text.reviewDescription}</DialogDescription>
                    </DialogHeader>
                    <pre className="max-h-80 overflow-auto rounded-lg bg-muted p-3 font-mono text-xs whitespace-pre-wrap select-text">
                        {review?.map((statement) => `${statement};`).join("\n")}
                    </pre>
                    <DialogFooter>
                        <Button variant="ghost" disabled={saving} onClick={() => setReview(null)}>
                            {t.common.back}
                        </Button>
                        <Button disabled={saving} onClick={() => void save()}>
                            {saving && (
                                <Loader2Icon className="animate-spin motion-reduce:animate-none" />
                            )}
                            {t.common.save}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
            <CellDialog
                state={cellDialog}
                onClose={() => setCellDialog(null)}
                onSave={(value) => {
                    if (cellDialog) {
                        const { row, col } = cellDialog;
                        setEdits((state) => editCell(state, context, row, col, value));
                    }
                    setCellDialog(null);
                }}
            />
        </div>
    );
}
