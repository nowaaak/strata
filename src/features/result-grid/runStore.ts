import { toast } from "sonner";
import { create } from "zustand";
import { errorMessage } from "@/api/invoke";
import { cancelQuery, executeQuery, loadTable } from "@/api/query";
import type { QueryEvent } from "@/bindings/QueryEvent";
import type { TableQuery } from "@/bindings/TableQuery";
import type { TableTarget } from "@/bindings/TableTarget";
import { getT } from "@/i18n";
import { failRun, reduceRun, startRun, type RunState } from "./runState";

type RunStore = {
    runs: Record<string, RunState>;
    nextRunId: number;
    begin: (tabId: string, baseOffset: number) => number;
    apply: (tabId: string, runId: number, event: QueryEvent) => void;
    fail: (tabId: string, runId: number, message: string) => void;
    select: (tabId: string, result: number) => void;
    forget: (tabId: string) => void;
};

export const useRuns = create<RunStore>((set, get) => ({
    runs: {},
    nextRunId: 1,

    begin: (tabId, baseOffset) => {
        const runId = get().nextRunId;
        set((state) => ({
            nextRunId: runId + 1,
            runs: { ...state.runs, [tabId]: startRun(runId, baseOffset) },
        }));
        return runId;
    },

    apply: (tabId, runId, event) =>
        set((state) => {
            const run = state.runs[tabId];
            if (!run || run.runId !== runId) {
                return state;
            }
            return { runs: { ...state.runs, [tabId]: reduceRun(run, event) } };
        }),

    fail: (tabId, runId, message) =>
        set((state) => {
            const run = state.runs[tabId];
            if (!run || run.runId !== runId) {
                return state;
            }
            return { runs: { ...state.runs, [tabId]: failRun(run, message) } };
        }),

    select: (tabId, result) =>
        set((state) => {
            const run = state.runs[tabId];
            return run ? { runs: { ...state.runs, [tabId]: { ...run, selected: result } } } : state;
        }),

    forget: (tabId) =>
        set((state) => {
            const runs = { ...state.runs };
            delete runs[tabId];
            return { runs };
        }),
}));

const inflight = new Map<string, Promise<void>>();

async function track(
    sessionId: string,
    tabId: string,
    baseOffset: number,
    start: (onEvent: (event: QueryEvent) => void) => Promise<void>,
): Promise<RunState | undefined> {
    const previous = inflight.get(tabId);
    if (previous) {
        void cancelQuery(sessionId, tabId).catch(() => undefined);
        await previous.catch(() => undefined);
    }
    const runId = useRuns.getState().begin(tabId, baseOffset);
    const running = start((event) => useRuns.getState().apply(tabId, runId, event));
    inflight.set(tabId, running);
    try {
        await running;
    } catch (error) {
        useRuns.getState().fail(tabId, runId, errorMessage(error));
    } finally {
        if (inflight.get(tabId) === running) {
            inflight.delete(tabId);
        }
    }
    return useRuns.getState().runs[tabId];
}

export function runSql(
    sessionId: string,
    tabId: string,
    database: string | null,
    sql: string,
    baseOffset: number,
) {
    return track(sessionId, tabId, baseOffset, (onEvent) =>
        executeQuery(sessionId, tabId, database, sql, onEvent),
    );
}

export function runTable(sessionId: string, tabId: string, target: TableTarget, query: TableQuery) {
    return track(sessionId, tabId, 0, (onEvent) =>
        loadTable(sessionId, tabId, target, query, onEvent),
    );
}

export function cancelRun(sessionId: string, tabId: string) {
    cancelQuery(sessionId, tabId).catch((error: unknown) =>
        toast.error(getT().query.cancelFailed, { description: errorMessage(error) }),
    );
}
