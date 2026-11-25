import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import {
    CheckIcon,
    CircleSlashIcon,
    ClipboardCopyIcon,
    CornerDownLeftIcon,
    FilePlus2Icon,
    SearchIcon,
    Trash2Icon,
    XCircleIcon,
} from "lucide-react";
import { useId, useRef, useState, type KeyboardEvent } from "react";
import { toast } from "sonner";
import { deleteHistoryEntry, historyKey, listHistory } from "@/api/history";
import { errorMessage } from "@/api/invoke";
import { useUiStore, type HistoryDialogState } from "@/app/uiStore";
import type { HistoryEntry } from "@/bindings/HistoryEntry";
import type { HistoryStatus } from "@/bindings/HistoryStatus";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useProfiles } from "@/features/connections/useProfiles";
import { editorFor } from "@/features/query-editor/editorRegistry";
import { SqlEditor } from "@/features/query-editor/SqlEditor";
import { formatDateTime, formatDuration, formatRelative } from "@/features/result-grid/format";
import { useSettings } from "@/features/settings/useSettings";
import { useWorkspace } from "@/features/workspace/workspaceStore";
import { useT } from "@/i18n";
import { cn } from "@/lib/utils";
import { useDebouncedValue } from "@/lib/useDebouncedValue";

export function HistoryDialog() {
    const t = useT();
    const state = useUiStore((ui) => ui.historyDialog);
    const close = () => useUiStore.getState().setHistoryDialog(null);

    return (
        <Dialog open={state !== null} onOpenChange={(open) => !open && close()}>
            <DialogContent className="flex h-[min(44rem,85vh)] flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl">
                <DialogTitle className="sr-only">{t.history.title}</DialogTitle>
                <DialogDescription className="sr-only">{t.history.description}</DialogDescription>
                {state && (
                    <HistoryBrowser
                        key={`${state.profileId}:${state.tabId}`}
                        state={state}
                        onClose={close}
                    />
                )}
            </DialogContent>
        </Dialog>
    );
}

function StatusIcon({ status }: { status: HistoryStatus }) {
    if (status === "success") {
        return <CheckIcon className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />;
    }
    if (status === "failed") {
        return <XCircleIcon className="size-3.5 shrink-0 text-destructive" />;
    }
    return <CircleSlashIcon className="size-3.5 shrink-0 text-amber-600 dark:text-amber-400" />;
}

function firstLine(sql: string): string {
    return sql.replace(/\s+/g, " ").trim();
}

function HistoryBrowser({
    state,
    onClose,
}: {
    state: NonNullable<HistoryDialogState>;
    onClose: () => void;
}) {
    const t = useT();
    const text = t.history;
    const baseId = useId();
    const searchRef = useRef<HTMLInputElement>(null);
    const queryClient = useQueryClient();
    const profiles = useProfiles().data ?? [];
    const enabled = useSettings().data?.historyEnabled ?? true;
    const [search, setSearch] = useState("");
    const [allConnections, setAllConnections] = useState(state.profileId === null);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const debounced = useDebouncedValue(search.trim(), 150);
    const profileId = allConnections ? null : state.profileId;

    const history = useQuery({
        queryKey: [...historyKey, profileId, debounced],
        queryFn: () => listHistory(profileId, debounced),
        placeholderData: keepPreviousData,
    });
    const entries = history.data ?? [];
    const selectedIndex = Math.max(
        0,
        entries.findIndex((entry) => entry.id === selectedId),
    );
    const selected = entries[selectedIndex];
    const profileName = (id: string) => profiles.find((profile) => profile.id === id)?.name ?? "";
    const engine = selected
        ? (profiles.find((profile) => profile.id === selected.profileId)?.engine ?? "mysql")
        : "mysql";

    const apply = (entry: HistoryEntry) => {
        if (!state.tabId) {
            return;
        }
        const view = editorFor(state.tabId);
        if (view) {
            view.dispatch({
                changes: { from: 0, to: view.state.doc.length, insert: entry.sql },
                selection: { anchor: entry.sql.length },
            });
            view.focus();
        } else {
            useWorkspace.getState().updateQueryTab(state.tabId, { sql: entry.sql });
        }
        onClose();
    };

    const openInTab = (entry: HistoryEntry) => {
        useWorkspace.getState().openProfileQueryTab(entry.profileId, entry.database, entry.sql);
        onClose();
    };

    const copy = async (entry: HistoryEntry) => {
        try {
            await navigator.clipboard.writeText(entry.sql);
            toast.success(text.copied);
        } catch (error) {
            toast.error(t.common.copyFailed, { description: errorMessage(error) });
        }
    };

    const remove = async (entry: HistoryEntry) => {
        try {
            await deleteHistoryEntry(entry.id);
            await queryClient.invalidateQueries({ queryKey: historyKey });
        } catch (error) {
            toast.error(text.deleteFailed, { description: errorMessage(error) });
        }
    };

    const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
        if (entries.length === 0) {
            return;
        }
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            const step = event.key === "ArrowDown" ? 1 : -1;
            const next = entries[(selectedIndex + step + entries.length) % entries.length];
            if (next) {
                setSelectedId(next.id);
                document
                    .getElementById(`${baseId}-${next.id}`)
                    ?.scrollIntoView({ block: "nearest" });
            }
        } else if (event.key === "Enter" && selected && !event.nativeEvent.isComposing) {
            event.preventDefault();
            if (state.tabId) {
                apply(selected);
            } else {
                openInTab(selected);
            }
        }
    };

    return (
        <>
            <div className="flex shrink-0 items-center gap-3 border-b px-4 pr-12">
                <SearchIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <input
                    ref={searchRef}
                    autoFocus
                    role="combobox"
                    aria-expanded
                    aria-controls={`${baseId}-list`}
                    aria-activedescendant={selected ? `${baseId}-${selected.id}` : undefined}
                    aria-label={text.search}
                    placeholder={text.search}
                    spellCheck={false}
                    value={search}
                    onChange={(event) => {
                        setSearch(event.target.value);
                        setSelectedId(null);
                    }}
                    onKeyDown={onKeyDown}
                    className="h-12 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                />
                {state.profileId && (
                    <div
                        role="radiogroup"
                        aria-label={text.scope}
                        className="flex shrink-0 rounded-lg bg-muted p-0.5"
                    >
                        {[false, true].map((all) => (
                            <button
                                key={String(all)}
                                type="button"
                                role="radio"
                                aria-checked={allConnections === all}
                                onClick={() => {
                                    setAllConnections(all);
                                    searchRef.current?.focus();
                                    setSelectedId(null);
                                }}
                                className={cn(
                                    "h-6 rounded-md px-2.5 text-xs text-muted-foreground",
                                    allConnections === all &&
                                        "bg-background text-foreground shadow-sm",
                                )}
                            >
                                {all ? text.allConnections : text.thisConnection}
                            </button>
                        ))}
                    </div>
                )}
            </div>
            {!enabled && (
                <p className="shrink-0 border-b bg-amber-500/10 px-4 py-2 text-xs text-amber-700 dark:text-amber-300">
                    {text.disabled}
                </p>
            )}
            <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
                <div
                    id={`${baseId}-list`}
                    role="listbox"
                    aria-label={text.title}
                    className="min-h-0 overflow-y-auto border-r p-1.5"
                >
                    {history.isError ? (
                        <p className="p-4 text-sm text-destructive select-text">
                            {text.loadFailed}: {errorMessage(history.error)}
                        </p>
                    ) : entries.length === 0 && !history.isPending ? (
                        <p className="p-6 text-center text-sm text-muted-foreground">
                            {debounced ? text.noMatches : text.empty}
                        </p>
                    ) : (
                        entries.map((entry, index) => (
                            <div
                                key={entry.id}
                                id={`${baseId}-${entry.id}`}
                                role="option"
                                aria-selected={index === selectedIndex}
                                onClick={() => setSelectedId(entry.id)}
                                onDoubleClick={() =>
                                    state.tabId ? apply(entry) : openInTab(entry)
                                }
                                className={cn(
                                    "flex cursor-pointer flex-col gap-1 rounded-lg px-3 py-2",
                                    index === selectedIndex ? "bg-accent" : "hover:bg-accent/50",
                                )}
                            >
                                <code className="truncate font-mono text-[12px]">
                                    {firstLine(entry.sql)}
                                </code>
                                <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                                    <StatusIcon status={entry.status} />
                                    <span>{formatRelative(entry.executedAt)}</span>
                                    <span>·</span>
                                    <span className="tabular-nums">
                                        {formatDuration(entry.durationMs)}
                                    </span>
                                    {entry.runs > 1 && <span>· {text.runs(entry.runs)}</span>}
                                    {allConnections && (
                                        <span className="ml-auto truncate">
                                            {profileName(entry.profileId)}
                                        </span>
                                    )}
                                </span>
                            </div>
                        ))
                    )}
                </div>
                <div className="flex min-h-0 flex-col">
                    {selected && (
                        <>
                            <dl className="grid shrink-0 grid-cols-[auto_1fr] gap-x-4 gap-y-1 border-b px-4 py-3 text-xs">
                                <dt className="text-muted-foreground">{text.executedAt}</dt>
                                <dd className="tabular-nums">
                                    {formatDateTime(selected.executedAt)}
                                    {selected.runs > 1 && ` · ${text.runs(selected.runs)}`}
                                </dd>
                                <dt className="text-muted-foreground">{text.database}</dt>
                                <dd>
                                    {profileName(selected.profileId)}
                                    {selected.database && ` / ${selected.database}`}
                                </dd>
                                <dt className="text-muted-foreground">{text.duration}</dt>
                                <dd className="flex items-center gap-1.5 tabular-nums">
                                    <StatusIcon status={selected.status} />
                                    {text.status[selected.status]} ·{" "}
                                    {formatDuration(selected.durationMs)}
                                    {selected.statements > 1 &&
                                        ` · ${text.statements(selected.statements)}`}
                                    {selected.rows !== null && ` · ${text.rows(selected.rows)}`}
                                    {selected.affected !== null &&
                                        ` · ${text.affected(selected.affected)}`}
                                </dd>
                            </dl>
                            {selected.error && (
                                <pre className="shrink-0 border-b bg-destructive/10 px-4 py-2 font-mono text-[12px] whitespace-pre-wrap text-destructive select-text">
                                    {selected.error}
                                </pre>
                            )}
                            <div className="min-h-0 flex-1">
                                <SqlEditor
                                    key={selected.id}
                                    label={text.title}
                                    initialValue={selected.sql}
                                    engine={engine}
                                    readOnly
                                />
                            </div>
                            <div className="flex shrink-0 items-center gap-2 border-t bg-muted/40 px-3 py-2">
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => void remove(selected)}
                                >
                                    <Trash2Icon />
                                    {text.delete}
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => void copy(selected)}
                                >
                                    <ClipboardCopyIcon />
                                    {text.copy}
                                </Button>
                                <Button
                                    className="ml-auto"
                                    variant={state.tabId ? "outline" : "default"}
                                    size="sm"
                                    onClick={() => openInTab(selected)}
                                >
                                    <FilePlus2Icon />
                                    {text.openInTab}
                                </Button>
                                {state.tabId && (
                                    <Button
                                        size="sm"
                                        title={text.applyHint}
                                        onClick={() => apply(selected)}
                                    >
                                        <CornerDownLeftIcon />
                                        {text.apply}
                                    </Button>
                                )}
                            </div>
                        </>
                    )}
                </div>
            </div>
        </>
    );
}
