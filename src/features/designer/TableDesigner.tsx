import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2Icon, PlusIcon, Trash2Icon, Undo2Icon } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { toast } from "sonner";
import {
    applyAlter,
    createTable,
    previewAlter,
    previewCreateTable,
    tableDesign,
} from "@/api/design";
import { errorMessage } from "@/api/invoke";
import { useUiStore, type DesignerRequest } from "@/app/uiStore";
import type { Engine } from "@/bindings/Engine";
import type { TableDesign } from "@/bindings/TableDesign";
import type { TableTarget } from "@/bindings/TableTarget";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { closeWorkspaceTab } from "@/features/connections/connect";
import { sameTarget, useWorkspace } from "@/features/workspace/workspaceStore";
import { getT, useT } from "@/i18n";
import { cn } from "@/lib/utils";
import {
    TYPE_SUGGESTIONS,
    alterOps,
    columnRows,
    idColumn,
    indexRows,
    isChanged,
    liveColumnNames,
    newColumn,
    newTable,
    rowKey,
    type ColumnRow,
    type DefaultMode,
    type IndexRow,
} from "./model";

const CHECKBOX = "size-4 cursor-pointer accent-[var(--primary)] disabled:cursor-not-allowed";

export function TableDesigner() {
    const request = useUiStore((ui) => ui.designerRequest);
    const engine = useWorkspace((state) =>
        request ? state.sessions[request.sessionId]?.engine : undefined,
    );
    const close = () => useUiStore.getState().setDesignerRequest(null);

    return (
        <Dialog
            open={request !== null && engine !== undefined}
            onOpenChange={(open) => !open && close()}
        >
            <DialogContent className="flex max-h-[calc(100vh-3rem)] flex-col sm:max-w-6xl">
                {request && engine && (
                    <DesignerBody
                        key={JSON.stringify(request)}
                        request={request}
                        engine={engine}
                        onDone={close}
                    />
                )}
            </DialogContent>
        </Dialog>
    );
}

function DesignerBody({
    request,
    engine,
    onDone,
}: {
    request: NonNullable<DesignerRequest>;
    engine: Engine;
    onDone: () => void;
}) {
    const t = useT();
    const text = t.designer;
    const design = useQuery({
        queryKey: [
            "table-design",
            request.sessionId,
            request.mode === "edit" ? request.target : null,
        ],
        queryFn: () =>
            request.mode === "edit"
                ? tableDesign(request.sessionId, request.target)
                : Promise.resolve<TableDesign>({ columns: [], indexes: [] }),
        staleTime: 0,
        gcTime: 0,
    });

    if (design.isPending) {
        return (
            <p className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
                <Loader2Icon className="size-4 animate-spin motion-reduce:animate-none" />
                {text.loading}
            </p>
        );
    }
    if (design.isError) {
        return (
            <p className="py-10 text-sm text-destructive select-text">
                {text.loadFailed}: {errorMessage(design.error)}
            </p>
        );
    }
    return <DesignerForm request={request} engine={engine} design={design.data} onDone={onDone} />;
}

function DesignerForm({
    request,
    engine,
    design,
    onDone,
}: {
    request: NonNullable<DesignerRequest>;
    engine: Engine;
    design: TableDesign;
    onDone: () => void;
}) {
    const t = useT();
    const text = t.designer;
    const id = useId();
    const queryClient = useQueryClient();
    const creating = request.mode === "create";
    const [tableName, setTableName] = useState("");
    const [columns, setColumns] = useState<ColumnRow[]>(() =>
        creating ? [idColumn(engine)] : columnRows(design),
    );
    const [indexes, setIndexes] = useState<IndexRow[]>(() => indexRows(design));
    const [statements, setStatements] = useState<string[] | null>(null);

    const target: TableTarget =
        request.mode === "edit"
            ? request.target
            : { database: request.database, schema: request.schema, table: tableName.trim() };
    const ops = useMemo(() => alterOps(columns, indexes), [columns, indexes]);
    const changeCount = creating ? columns.filter((row) => !row.dropped).length : ops.length;

    const updateColumn = (key: string, patch: Partial<ColumnRow>) =>
        setColumns((rows) => rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));
    const removeColumn = (row: ColumnRow) =>
        row.original
            ? updateColumn(row.key, { dropped: !row.dropped })
            : setColumns((rows) => rows.filter((candidate) => candidate.key !== row.key));

    const review = useMutation({
        mutationFn: () =>
            creating
                ? previewCreateTable(request.sessionId, newTable(target, columns))
                : previewAlter(request.sessionId, target, ops),
        onSuccess: setStatements,
        onError: (error) =>
            toast.error(getT().designer.failed, { description: errorMessage(error) }),
    });

    const run = useMutation({
        mutationFn: () =>
            creating
                ? createTable(request.sessionId, newTable(target, columns))
                : applyAlter(request.sessionId, target, ops),
        onSuccess: async () => {
            onDone();
            toast.success(creating ? getT().designer.created(target.table) : getT().designer.done);
            await queryClient.invalidateQueries({
                predicate: (query) => query.queryKey[1] === request.sessionId,
            });
            const workspace = useWorkspace.getState();
            if (creating) {
                workspace.openTableTab(request.sessionId, target);
                return;
            }
            for (const tab of workspace.tabs) {
                if (tab.kind === "table" && sameTarget(tab.target, target)) {
                    closeWorkspaceTab(tab.id);
                    useWorkspace.getState().openTableTab(request.sessionId, target);
                }
            }
        },
        onError: (error) =>
            toast.error(getT().designer.failed, { description: errorMessage(error) }),
    });

    const canReview =
        changeCount > 0 &&
        (!creating || tableName.trim() !== "") &&
        columns.every(
            (row) => row.dropped || (row.name.trim() !== "" && row.dataType.trim() !== ""),
        );
    const destructive = ops.some((op) => op.op === "drop_column" || op.op === "drop_index");
    const container =
        request.mode === "create" ? (request.schema ?? request.database) : request.target.table;

    if (statements) {
        return (
            <>
                <DialogHeader>
                    <DialogTitle>{text.reviewTitle}</DialogTitle>
                    <DialogDescription>
                        {creating
                            ? text.createDescription
                            : engine === "postgres"
                              ? text.reviewHintPostgres
                              : text.reviewHintMysql}
                    </DialogDescription>
                </DialogHeader>
                <pre className="min-h-0 flex-1 overflow-auto rounded-lg bg-muted p-3 font-mono text-xs whitespace-pre-wrap select-text">
                    {statements.join(";\n\n")};
                </pre>
                <DialogFooter>
                    <Button
                        variant="ghost"
                        disabled={run.isPending}
                        onClick={() => setStatements(null)}
                    >
                        {text.back}
                    </Button>
                    <Button
                        variant={destructive ? "destructive" : "default"}
                        disabled={run.isPending}
                        onClick={() => run.mutate()}
                    >
                        {run.isPending && (
                            <Loader2Icon className="animate-spin motion-reduce:animate-none" />
                        )}
                        {text.run}
                    </Button>
                </DialogFooter>
            </>
        );
    }

    return (
        <>
            <DialogHeader>
                <DialogTitle className="break-words">
                    {creating ? text.createTitle(container) : text.editTitle(container)}
                </DialogTitle>
                <DialogDescription>
                    {creating ? text.createDescription : text.editDescription}
                </DialogDescription>
            </DialogHeader>

            <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-auto pr-1">
                {creating && (
                    <div className="flex max-w-sm flex-col gap-1.5">
                        <Label htmlFor={`${id}-table`}>{text.tableName}</Label>
                        <Input
                            id={`${id}-table`}
                            autoFocus
                            spellCheck={false}
                            autoComplete="off"
                            maxLength={128}
                            value={tableName}
                            onChange={(event) => setTableName(event.target.value)}
                        />
                    </div>
                )}

                <section className="flex flex-col gap-2">
                    <h3 className="text-sm font-medium">{text.columns}</h3>
                    <div className="overflow-x-auto rounded-lg border">
                        <table className="w-full border-collapse text-left text-[13px]">
                            <thead className="bg-muted text-xs text-muted-foreground">
                                <tr>
                                    {creating && (
                                        <th
                                            className="w-10 px-2 py-2 text-center font-medium"
                                            title={text.column.primaryHint}
                                        >
                                            {text.column.primary}
                                        </th>
                                    )}
                                    <th className="px-2 py-2 font-medium">{text.column.name}</th>
                                    <th className="px-2 py-2 font-medium">{text.column.type}</th>
                                    <th
                                        className="w-12 px-2 py-2 text-center font-medium"
                                        title={text.column.nullableHint}
                                    >
                                        {text.column.nullable}
                                    </th>
                                    <th className="px-2 py-2 font-medium">{text.column.default}</th>
                                    <th
                                        className="w-10 px-2 py-2 text-center font-medium"
                                        title={text.column.autoIncrementHint}
                                    >
                                        {text.column.autoIncrement}
                                    </th>
                                    <th className="w-10 px-2 py-2" />
                                </tr>
                            </thead>
                            <tbody>
                                {columns.map((row) => (
                                    <ColumnEditor
                                        key={row.key}
                                        row={row}
                                        creating={creating}
                                        listId={`${id}-types`}
                                        onChange={(patch) => updateColumn(row.key, patch)}
                                        onRemove={() => removeColumn(row)}
                                    />
                                ))}
                            </tbody>
                        </table>
                        <datalist id={`${id}-types`}>
                            {TYPE_SUGGESTIONS[engine].map((type) => (
                                <option key={type} value={type} />
                            ))}
                        </datalist>
                    </div>
                    <Button
                        variant="outline"
                        size="sm"
                        className="self-start"
                        onClick={() => setColumns((rows) => [...rows, newColumn(engine)])}
                    >
                        <PlusIcon />
                        {text.addColumn}
                    </Button>
                </section>

                {!creating && (
                    <IndexEditor
                        indexes={indexes}
                        columnNames={liveColumnNames(columns)}
                        onChange={setIndexes}
                    />
                )}
            </div>

            <DialogFooter className="items-center sm:justify-between">
                <span className="text-xs text-muted-foreground">
                    {creating ? "" : text.changes(changeCount)}
                </span>
                <div className="flex gap-2">
                    <Button variant="ghost" onClick={onDone}>
                        {t.common.cancel}
                    </Button>
                    <Button
                        disabled={!canReview || review.isPending}
                        onClick={() => review.mutate()}
                    >
                        {review.isPending && (
                            <Loader2Icon className="animate-spin motion-reduce:animate-none" />
                        )}
                        {text.review}
                    </Button>
                </div>
            </DialogFooter>
        </>
    );
}

function ColumnEditor({
    row,
    creating,
    listId,
    onChange,
    onRemove,
}: {
    row: ColumnRow;
    creating: boolean;
    listId: string;
    onChange: (patch: Partial<ColumnRow>) => void;
    onRemove: () => void;
}) {
    const t = useT();
    const text = t.designer;
    const locked = row.dropped || (row.original?.generated ?? false);
    const modes: DefaultMode[] = row.original
        ? ["keep", "none", "null", "text", "expression"]
        : ["none", "null", "text", "expression"];
    const current = row.original?.default ?? null;

    return (
        <tr
            className={cn(
                "border-t align-middle",
                row.dropped && "bg-destructive/5 text-muted-foreground line-through",
                !row.original && "bg-emerald-500/5",
                !row.dropped && isChanged(row) && "bg-primary/5",
            )}
        >
            {creating && (
                <td className="px-2 py-1.5 text-center">
                    <input
                        type="checkbox"
                        className={CHECKBOX}
                        aria-label={text.column.primaryHint}
                        checked={row.primary}
                        onChange={(event) =>
                            onChange({
                                primary: event.target.checked,
                                nullable: event.target.checked ? false : row.nullable,
                            })
                        }
                    />
                </td>
            )}
            <td className="px-2 py-1.5">
                <div className="flex items-center gap-1.5">
                    <Input
                        aria-label={text.column.name}
                        spellCheck={false}
                        autoComplete="off"
                        maxLength={128}
                        disabled={locked}
                        value={row.name}
                        onChange={(event) => onChange({ name: event.target.value })}
                        className="h-7 min-w-32 font-mono text-xs"
                    />
                    {row.original?.generated && (
                        <span
                            title={text.column.generatedHint}
                            className="rounded bg-muted px-1.5 py-0.5 text-[0.6875rem] text-muted-foreground no-underline"
                        >
                            {text.column.generated}
                        </span>
                    )}
                </div>
            </td>
            <td className="px-2 py-1.5">
                <Input
                    aria-label={text.column.type}
                    list={listId}
                    spellCheck={false}
                    autoComplete="off"
                    disabled={locked}
                    value={row.dataType}
                    onChange={(event) => onChange({ dataType: event.target.value })}
                    className="h-7 min-w-36 font-mono text-xs"
                />
            </td>
            <td className="px-2 py-1.5 text-center">
                <input
                    type="checkbox"
                    className={CHECKBOX}
                    aria-label={text.column.nullableHint}
                    disabled={locked || row.primary}
                    checked={row.nullable}
                    onChange={(event) => onChange({ nullable: event.target.checked })}
                />
            </td>
            <td className="px-2 py-1.5">
                <div className="flex min-w-56 items-center gap-1.5">
                    <Select
                        value={row.defaultMode}
                        disabled={locked}
                        onValueChange={(mode) => onChange({ defaultMode: mode as DefaultMode })}
                    >
                        <SelectTrigger
                            size="sm"
                            aria-label={text.column.default}
                            className="h-7 w-36 text-xs"
                        >
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {modes.map((mode) => (
                                <SelectItem key={mode} value={mode}>
                                    {text.defaults[mode]}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    {(row.defaultMode === "text" || row.defaultMode === "expression") && (
                        <Input
                            aria-label={text.defaultPlaceholder[row.defaultMode]}
                            placeholder={text.defaultPlaceholder[row.defaultMode]}
                            spellCheck={false}
                            disabled={locked}
                            value={row.defaultValue}
                            onChange={(event) => onChange({ defaultValue: event.target.value })}
                            className="h-7 min-w-32 font-mono text-xs"
                        />
                    )}
                    {row.defaultMode === "keep" && (
                        <span
                            className="truncate font-mono text-xs text-muted-foreground"
                            title={current ?? undefined}
                        >
                            {current ?? text.column.none}
                        </span>
                    )}
                </div>
            </td>
            <td className="px-2 py-1.5 text-center">
                <input
                    type="checkbox"
                    className={CHECKBOX}
                    aria-label={text.column.autoIncrementHint}
                    disabled={locked}
                    checked={row.autoIncrement}
                    onChange={(event) => onChange({ autoIncrement: event.target.checked })}
                />
            </td>
            <td className="px-1 py-1.5 text-right">
                <Button
                    size="icon"
                    variant="ghost"
                    className="size-7"
                    aria-label={
                        row.dropped ? text.column.restore(row.name) : text.column.remove(row.name)
                    }
                    title={
                        row.dropped ? text.column.restore(row.name) : text.column.remove(row.name)
                    }
                    onClick={onRemove}
                >
                    {row.dropped ? <Undo2Icon /> : <Trash2Icon />}
                </Button>
            </td>
        </tr>
    );
}

function IndexEditor({
    indexes,
    columnNames,
    onChange,
}: {
    indexes: IndexRow[];
    columnNames: string[];
    onChange: (indexes: IndexRow[]) => void;
}) {
    const t = useT();
    const text = t.designer.index;
    const id = useId();
    const [name, setName] = useState("");
    const [picked, setPicked] = useState<string[]>([]);
    const [unique, setUnique] = useState(false);

    const toggle = (index: IndexRow) =>
        index.original
            ? onChange(
                  indexes.map((row) =>
                      row.key === index.key ? { ...row, dropped: !row.dropped } : row,
                  ),
              )
            : onChange(indexes.filter((row) => row.key !== index.key));

    const add = () => {
        onChange([
            ...indexes,
            {
                key: rowKey(),
                original: null,
                name: name.trim(),
                columns: picked,
                unique,
                dropped: false,
            },
        ]);
        setName("");
        setPicked([]);
        setUnique(false);
    };

    return (
        <section className="flex flex-col gap-2">
            <h3 className="text-sm font-medium">{t.designer.indexes}</h3>
            {indexes.length > 0 && (
                <ul className="flex flex-col divide-y rounded-lg border text-[13px]">
                    {indexes.map((index) => (
                        <li
                            key={index.key}
                            className={cn(
                                "flex items-center gap-3 px-3 py-1.5",
                                index.dropped &&
                                    "bg-destructive/5 text-muted-foreground line-through",
                                !index.original && "bg-emerald-500/5",
                            )}
                        >
                            <span className="min-w-40 font-mono text-xs">{index.name}</span>
                            <span className="flex-1 truncate font-mono text-xs text-muted-foreground">
                                {index.columns.join(", ")}
                            </span>
                            {index.original?.primary && (
                                <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[0.6875rem] font-medium text-primary">
                                    {text.primary}
                                </span>
                            )}
                            {index.unique && !index.original?.primary && (
                                <span className="rounded bg-muted px-1.5 py-0.5 text-[0.6875rem]">
                                    {text.unique}
                                </span>
                            )}
                            {index.original && !index.original.editable && (
                                <span className="text-[0.6875rem] text-muted-foreground">
                                    {text.notEditable}
                                </span>
                            )}
                            <Button
                                size="icon"
                                variant="ghost"
                                className="size-7"
                                aria-label={
                                    index.dropped
                                        ? text.restore(index.name)
                                        : text.remove(index.name)
                                }
                                title={
                                    index.dropped
                                        ? text.restore(index.name)
                                        : text.remove(index.name)
                                }
                                onClick={() => toggle(index)}
                            >
                                {index.dropped ? <Undo2Icon /> : <Trash2Icon />}
                            </Button>
                        </li>
                    ))}
                </ul>
            )}
            <div className="flex flex-col gap-2 rounded-lg border border-dashed p-3">
                <div className="flex flex-wrap items-end gap-3">
                    <div className="flex flex-col gap-1.5">
                        <Label htmlFor={`${id}-name`} className="text-xs">
                            {text.name}
                        </Label>
                        <Input
                            id={`${id}-name`}
                            placeholder={text.namePlaceholder}
                            spellCheck={false}
                            autoComplete="off"
                            maxLength={128}
                            value={name}
                            onChange={(event) => setName(event.target.value)}
                            className="h-7 w-56 font-mono text-xs"
                        />
                    </div>
                    <label className="flex h-7 items-center gap-2 text-xs">
                        <input
                            type="checkbox"
                            className={CHECKBOX}
                            checked={unique}
                            onChange={(event) => setUnique(event.target.checked)}
                        />
                        {text.unique}
                    </label>
                    <Button
                        size="sm"
                        variant="outline"
                        disabled={name.trim() === "" || picked.length === 0}
                        onClick={add}
                    >
                        <PlusIcon />
                        {text.add}
                    </Button>
                </div>
                <div className="flex flex-col gap-1.5">
                    <span className="text-xs text-muted-foreground">{text.pickColumns}</span>
                    <div role="group" aria-label={text.columns} className="flex flex-wrap gap-1.5">
                        {columnNames.map((column) => {
                            const position = picked.indexOf(column);
                            return (
                                <button
                                    key={column}
                                    type="button"
                                    aria-pressed={position >= 0}
                                    onClick={() =>
                                        setPicked((current) =>
                                            position >= 0
                                                ? current.filter((entry) => entry !== column)
                                                : [...current, column],
                                        )
                                    }
                                    className={cn(
                                        "rounded-md border px-2 py-0.5 font-mono text-xs outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring",
                                        position >= 0 &&
                                            "border-primary bg-primary/10 text-primary",
                                    )}
                                >
                                    {position >= 0 && (
                                        <span className="mr-1 tabular-nums">{position + 1}.</span>
                                    )}
                                    {column}
                                </button>
                            );
                        })}
                    </div>
                </div>
            </div>
        </section>
    );
}
