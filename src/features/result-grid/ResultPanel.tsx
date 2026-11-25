import {
    AlertTriangleIcon,
    CheckIcon,
    CircleSlashIcon,
    Loader2Icon,
    SquareIcon,
    XCircleIcon,
} from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useT, type Messages } from "@/i18n";
import { cn } from "@/lib/utils";
import { DataGrid } from "./DataGrid";
import { ExportMenu } from "./ExportMenu";
import { formatCount, formatDuration } from "./format";
import { firstError, type RunState, type StatementState } from "./runState";
import { cancelRun, useRuns } from "./runStore";
import { useResultCache } from "./useResultCache";

function outcomeText(statement: StatementState, t: Messages): string {
    const status = t.query.status;
    switch (statement.status) {
        case "skipped":
            return status.skipped;
        case "running":
            return status.running;
        case "pending":
            return status.pending;
        case "failed":
            return status.failed;
        case "done": {
            const outcome = statement.outcome;
            if (!outcome) {
                return "";
            }
            return outcome.type === "rows"
                ? status.rows(formatCount(outcome.rows), outcome.truncated)
                : status.affected(formatCount(outcome.rows));
        }
    }
}

function StatusIcon({ statement }: { statement: StatementState }) {
    switch (statement.status) {
        case "done":
            return (
                <CheckIcon
                    className="size-3.5 text-emerald-600 dark:text-emerald-400"
                    aria-hidden
                />
            );
        case "failed":
            return <XCircleIcon className="size-3.5 text-destructive" aria-hidden />;
        case "running":
            return (
                <Loader2Icon
                    className="size-3.5 animate-spin text-muted-foreground motion-reduce:animate-none"
                    aria-hidden
                />
            );
        default:
            return <CircleSlashIcon className="size-3.5 text-muted-foreground/60" aria-hidden />;
    }
}

function Messages({ run }: { run: RunState }) {
    const t = useT();
    return (
        <ol className="flex flex-col divide-y divide-border overflow-auto text-[12.5px]">
            {run.statements.map((statement) => (
                <li key={statement.index} className="flex flex-col gap-1 px-4 py-2">
                    <div className="flex items-center gap-2">
                        <StatusIcon statement={statement} />
                        <code className="min-w-0 flex-1 truncate font-mono text-[12px] text-muted-foreground">
                            {statement.text.replace(/\s+/g, " ")}
                        </code>
                        <span className="shrink-0 tabular-nums">{outcomeText(statement, t)}</span>
                        {statement.elapsedMs !== null && (
                            <span className="w-16 shrink-0 text-right text-muted-foreground tabular-nums">
                                {formatDuration(statement.elapsedMs)}
                            </span>
                        )}
                    </div>
                    {statement.message && (
                        <pre className="ml-5.5 font-mono text-[12px] whitespace-pre-wrap text-destructive select-text">
                            {statement.message}
                        </pre>
                    )}
                </li>
            ))}
        </ol>
    );
}

export function RunStatus({ run, onCancel }: { run: RunState; onCancel: () => void }) {
    const t = useT();
    const status = t.query.status;
    const failed = firstError(run);
    const done = run.statements.filter((statement) => statement.status === "done").length;
    if (run.running) {
        return (
            <span className="flex items-center gap-2">
                <Loader2Icon
                    className="size-3.5 animate-spin motion-reduce:animate-none"
                    aria-hidden
                />
                {status.running}
                <Button variant="ghost" size="xs" onClick={onCancel}>
                    <SquareIcon />
                    {t.query.cancel}
                </Button>
            </span>
        );
    }
    return (
        <span className="flex items-center gap-2 tabular-nums">
            {run.cancelled && (
                <span className="text-amber-600 dark:text-amber-400">{status.cancelled}</span>
            )}
            {failed && !run.cancelled && <span className="text-destructive">{status.failed}</span>}
            {run.statements.length > 1 && (
                <span>{status.statements(done, run.statements.length)}</span>
            )}
            {run.elapsedMs !== null && (
                <span className="text-muted-foreground">{formatDuration(run.elapsedMs)}</span>
            )}
        </span>
    );
}

export function ResultPanel({
    sessionId,
    tabId,
    exportName,
}: {
    sessionId: string;
    tabId: string;
    exportName: string;
}) {
    const t = useT();
    const run = useRuns((state) => state.runs[tabId]);
    const [messagesRunId, setMessagesRunId] = useState<number | null>(null);
    const result = run?.results.find((info) => info.result === run.selected);
    const cache = useResultCache(sessionId, tabId, run?.runId, result?.result);

    if (!run) {
        return (
            <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
                <p>{t.query.emptyHint}</p>
            </div>
        );
    }

    const failed = firstError(run);
    const messagesView = messagesRunId === run.runId || (!result && run.statements.length > 0);
    const select = (index: number) => {
        useRuns.getState().select(tabId, index);
        setMessagesRunId(null);
    };
    const tabClass = (selected: boolean) =>
        cn(
            "h-6 rounded-md px-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground",
            selected && "bg-accent text-foreground",
        );

    return (
        <div className="flex h-full min-h-0 flex-col">
            {run.error && (
                <div
                    role="alert"
                    className="flex items-start gap-2 border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive"
                >
                    <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
                    <span className="select-text">{run.error}</span>
                </div>
            )}
            {failed?.message && !messagesView && (
                <div
                    role="alert"
                    className="flex items-start gap-2 border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-[12.5px] text-destructive"
                >
                    <XCircleIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
                    <pre className="font-mono whitespace-pre-wrap select-text">
                        {failed.message}
                    </pre>
                </div>
            )}
            {(run.results.length > 1 || run.statements.length > 1) && (
                <div
                    role="tablist"
                    aria-label={t.query.results.label}
                    className="flex shrink-0 gap-1 border-b px-2 py-1"
                >
                    {run.results.map((info, index) => (
                        <button
                            key={info.result}
                            type="button"
                            role="tab"
                            aria-selected={!messagesView && info.result === run.selected}
                            onClick={() => select(info.result)}
                            className={tabClass(!messagesView && info.result === run.selected)}
                        >
                            {t.query.results.result(index + 1)}
                        </button>
                    ))}
                    <button
                        type="button"
                        role="tab"
                        aria-selected={messagesView}
                        onClick={() => setMessagesRunId(run.runId)}
                        className={tabClass(messagesView)}
                    >
                        {t.query.results.messages}
                    </button>
                </div>
            )}
            <div className="min-h-0 flex-1">
                {messagesView ? (
                    <Messages run={run} />
                ) : result && cache ? (
                    <DataGrid
                        key={`${run.runId}:${result.result}`}
                        label={t.query.results.grid}
                        columns={result.columns}
                        rowCount={result.rows}
                        cache={cache}
                    />
                ) : run.running ? (
                    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                        {t.query.status.waiting}
                    </div>
                ) : null}
            </div>
            <footer className="flex h-8 shrink-0 items-center justify-between gap-3 border-t px-3 text-xs">
                <RunStatus run={run} onCancel={() => cancelRun(sessionId, tabId)} />
                <span className="flex items-center gap-3 tabular-nums">
                    {result && !messagesView && (
                        <>
                            <span>
                                {t.query.results.size(
                                    formatCount(result.rows),
                                    result.columns.length,
                                )}
                            </span>
                            {result.truncated && (
                                <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-amber-700 dark:text-amber-300">
                                    {t.query.results.limitReached}
                                </span>
                            )}
                            <ExportMenu
                                sessionId={sessionId}
                                tabId={tabId}
                                result={result.result}
                                baseName={exportName}
                                disabled={run.running}
                            />
                        </>
                    )}
                </span>
            </footer>
        </div>
    );
}
