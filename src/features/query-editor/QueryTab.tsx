import type { SQLNamespace } from "@codemirror/lang-sql";
import type { EditorView } from "@codemirror/view";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DatabaseIcon, ListChecksIcon, PlayIcon, ShieldAlertIcon, SquareIcon } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { errorMessage } from "@/api/invoke";
import { splitSql } from "@/api/query";
import { completionSchema, listDatabases } from "@/api/schema";
import type { CompletionTable } from "@/bindings/CompletionTable";
import type { SqlStatement } from "@/bindings/SqlStatement";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useProfile } from "@/features/connections/useProfiles";
import { ResultPanel } from "@/features/result-grid/ResultPanel";
import { firstError } from "@/features/result-grid/runState";
import { cancelRun, runSql, useRuns } from "@/features/result-grid/runStore";
import {
    tabTitle,
    useWorkspace,
    type QueryTab as QueryTabModel,
} from "@/features/workspace/workspaceStore";
import { clearError, showError, SqlEditor } from "./SqlEditor";
import { useT } from "@/i18n";
import { statementAt } from "./statements";

const SCHEMA_KEYS = new Set(["databases", "schemas", "objects", "completion", "table-info", "ddl"]);

function namespace(tables: CompletionTable[] | undefined): SQLNamespace | undefined {
    if (!tables) {
        return undefined;
    }
    const result: Record<string, Record<string, string[]>> = {};
    for (const table of tables) {
        const schema = (result[table.schema] ??= {});
        schema[table.table] = table.columns;
    }
    return result;
}

type PendingRun = { sql: string; base: number; writes: SqlStatement[] };

export function QueryTab({ tab }: { tab: QueryTabModel }) {
    const t = useT();
    const queryClient = useQueryClient();
    const session = useWorkspace((state) => state.sessions[tab.sessionId]);
    const profile = useProfile(tab.profileId);
    const running = useRuns((state) => state.runs[tab.id]?.running ?? false);
    const viewRef = useRef<EditorView | null>(null);
    const [pending, setPending] = useState<PendingRun | null>(null);
    const engine = session?.engine ?? "mysql";

    const databases = useQuery({
        queryKey: ["databases", tab.sessionId],
        queryFn: () => listDatabases(tab.sessionId),
        staleTime: 60_000,
        enabled: session !== undefined,
    });
    const completion = useQuery({
        queryKey: ["completion", tab.sessionId, tab.database],
        queryFn: () => completionSchema(tab.sessionId, tab.database ?? ""),
        staleTime: 60_000,
        enabled: session !== undefined && tab.database !== null,
    });
    const schema = useMemo(() => namespace(completion.data), [completion.data]);
    const defaultSchema = engine === "postgres" ? "public" : (tab.database ?? undefined);

    const execute = async (sql: string, base: number) => {
        const final = await runSql(tab.sessionId, tab.id, tab.database, sql, base);
        if (!final) {
            return;
        }
        const failed = firstError(final);
        const view = viewRef.current;
        if (failed && failed.errorAt !== null && view) {
            showError(view, final.baseOffset + failed.errorAt);
        }
        const wrote = final.statements.some(
            (statement) => statement.writes && statement.status === "done",
        );
        if (wrote) {
            void queryClient.invalidateQueries({
                predicate: (query) =>
                    query.queryKey[1] === tab.sessionId &&
                    SCHEMA_KEYS.has(String(query.queryKey[0])),
            });
        }
    };

    const prepare = async (mode: "current" | "all") => {
        const view = viewRef.current;
        if (!view || !session || running) {
            return;
        }
        clearError(view);
        const doc = view.state.doc.toString();
        const selection = view.state.selection.main;
        let sql = doc;
        let base = 0;
        try {
            if (mode === "current") {
                if (!selection.empty) {
                    sql = doc.slice(selection.from, selection.to);
                    base = selection.from;
                } else {
                    const statement = statementAt(
                        await splitSql(tab.sessionId, doc),
                        selection.head,
                    );
                    if (!statement) {
                        return;
                    }
                    sql = doc.slice(statement.start, statement.end);
                    base = statement.start;
                }
            }
            if (sql.trim() === "") {
                return;
            }
            if (profile?.safety === "confirm") {
                const writes = (await splitSql(tab.sessionId, sql)).filter(
                    (statement) => statement.writes,
                );
                if (writes.length > 0) {
                    setPending({ sql, base, writes });
                    return;
                }
            }
            await execute(sql, base);
        } catch (error) {
            toast.error(t.query.startFailed, {
                description: errorMessage(error),
            });
        }
    };

    const cancel = () => cancelRun(tab.sessionId, tab.id);

    return (
        <div className="flex h-full min-h-0 flex-col">
            <div className="flex h-10 shrink-0 items-center gap-1.5 border-b px-2">
                {running ? (
                    <Button size="sm" variant="secondary" onClick={cancel}>
                        <SquareIcon />
                        {t.query.cancel}
                    </Button>
                ) : (
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button
                                size="sm"
                                onClick={() => void prepare("current")}
                                disabled={!session}
                            >
                                <PlayIcon />
                                {t.query.run}
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent>{t.query.runHint}</TooltipContent>
                    </Tooltip>
                )}
                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => void prepare("all")}
                            disabled={!session || running}
                        >
                            <ListChecksIcon />
                            {t.query.all}
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent>{t.query.allHint}</TooltipContent>
                </Tooltip>
                <div className="mx-1 h-5 w-px bg-border" />
                <Select
                    value={tab.database ?? undefined}
                    onValueChange={(database) =>
                        useWorkspace.getState().updateQueryTab(tab.id, { database })
                    }
                >
                    <SelectTrigger
                        size="sm"
                        aria-label={t.query.database}
                        className="h-7 min-w-40 gap-1.5 text-xs"
                    >
                        <DatabaseIcon className="size-3.5 text-muted-foreground" aria-hidden />
                        <SelectValue placeholder={t.query.noDatabase} />
                    </SelectTrigger>
                    <SelectContent>
                        {(databases.data ?? []).map((database) => (
                            <SelectItem key={database} value={database}>
                                {database}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                {session?.readOnly && (
                    <span className="ml-auto flex items-center gap-1 rounded-md bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-300">
                        <ShieldAlertIcon className="size-3.5" aria-hidden />
                        {t.query.readOnly}
                    </span>
                )}
                {profile?.safety === "confirm" && (
                    <span className="ml-auto flex items-center gap-1 rounded-md bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-300">
                        <ShieldAlertIcon className="size-3.5" aria-hidden />
                        {t.query.confirmBadge}
                    </span>
                )}
            </div>
            <ResizablePanelGroup orientation="vertical" className="min-h-0 flex-1">
                <ResizablePanel defaultSize="42" minSize={80}>
                    <SqlEditor
                        label={t.query.editorLabel(tabTitle(tab, t))}
                        initialValue={tab.sql}
                        engine={engine}
                        schema={schema}
                        defaultSchema={defaultSchema}
                        onChange={(sql) => useWorkspace.getState().updateQueryTab(tab.id, { sql })}
                        onRunCurrent={() => void prepare("current")}
                        onRunAll={() => void prepare("all")}
                        onCancel={cancel}
                        onView={(view) => {
                            viewRef.current = view;
                        }}
                    />
                </ResizablePanel>
                <ResizableHandle />
                <ResizablePanel minSize={120}>
                    <ResultPanel
                        sessionId={tab.sessionId}
                        tabId={tab.id}
                        exportName={tabTitle(tab, t)}
                    />
                </ResizablePanel>
            </ResizablePanelGroup>
            <AlertDialog open={pending !== null} onOpenChange={(open) => !open && setPending(null)}>
                <AlertDialogContent className="sm:max-w-lg">
                    <AlertDialogHeader>
                        <AlertDialogTitle>
                            {t.query.confirmTitle(profile?.name ?? "")}
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                            {t.query.confirmDescription}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <pre className="max-h-60 overflow-auto rounded-lg bg-muted p-3 font-mono text-xs whitespace-pre-wrap select-text">
                        {pending?.writes.map((statement) => statement.text).join(";\n\n")}
                    </pre>
                    <AlertDialogFooter>
                        <AlertDialogCancel>{t.common.cancel}</AlertDialogCancel>
                        <AlertDialogAction
                            variant="destructive"
                            onClick={() => {
                                const run = pending;
                                setPending(null);
                                if (run) {
                                    void execute(run.sql, run.base);
                                }
                            }}
                        >
                            {t.query.execute}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}
