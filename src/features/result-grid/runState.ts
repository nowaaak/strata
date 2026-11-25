import type { ColumnMeta } from "@/bindings/ColumnMeta";
import type { QueryEvent } from "@/bindings/QueryEvent";
import type { StatementOutcome } from "@/bindings/StatementOutcome";

export type StatementStatus = "pending" | "running" | "done" | "failed" | "skipped";

export type StatementState = {
    index: number;
    text: string;
    start: number;
    end: number;
    writes: boolean;
    status: StatementStatus;
    outcome: StatementOutcome | null;
    elapsedMs: number | null;
    message: string | null;
    errorAt: number | null;
};

export type ResultInfo = {
    result: number;
    statementIndex: number;
    columns: ColumnMeta[];
    rows: number;
    truncated: boolean;
    complete: boolean;
};

export type RunState = {
    runId: number;
    running: boolean;
    cancelled: boolean;
    elapsedMs: number | null;
    baseOffset: number;
    statements: StatementState[];
    results: ResultInfo[];
    selected: number;
    error: string | null;
};

export function startRun(runId: number, baseOffset: number): RunState {
    return {
        runId,
        running: true,
        cancelled: false,
        elapsedMs: null,
        baseOffset,
        statements: [],
        results: [],
        selected: 0,
        error: null,
    };
}

function updateStatement(
    state: RunState,
    index: number,
    patch: Partial<StatementState>,
): StatementState[] {
    return state.statements.map((statement) =>
        statement.index === index ? { ...statement, ...patch } : statement,
    );
}

function updateResult(state: RunState, result: number, patch: Partial<ResultInfo>): ResultInfo[] {
    return state.results.map((info) => (info.result === result ? { ...info, ...patch } : info));
}

export function reduceRun(state: RunState, event: QueryEvent): RunState {
    switch (event.type) {
        case "plan":
            return {
                ...state,
                statements: event.statements.map((statement, index) => ({
                    index,
                    text: statement.text,
                    start: statement.start,
                    end: statement.end,
                    writes: statement.writes,
                    status: "pending",
                    outcome: null,
                    elapsedMs: null,
                    message: null,
                    errorAt: null,
                })),
            };
        case "statementStarted":
            return {
                ...state,
                statements: updateStatement(state, event.index, { status: "running" }),
            };
        case "columns": {
            const results = [
                ...state.results.filter((info) => info.result !== event.result),
                {
                    result: event.result,
                    statementIndex: event.index,
                    columns: event.columns,
                    rows: 0,
                    truncated: false,
                    complete: false,
                },
            ];
            return {
                ...state,
                results,
                selected: state.results.length === 0 ? event.result : state.selected,
            };
        }
        case "progress":
            return { ...state, results: updateResult(state, event.result, { rows: event.rows }) };
        case "statementFinished": {
            const outcome = event.outcome;
            const results =
                outcome.type === "rows"
                    ? updateResult(state, outcome.result, {
                          rows: outcome.rows,
                          truncated: outcome.truncated,
                          complete: true,
                      })
                    : state.results;
            return {
                ...state,
                results,
                statements: updateStatement(state, event.index, {
                    status: "done",
                    outcome,
                    elapsedMs: event.elapsedMs,
                }),
            };
        }
        case "statementFailed":
            return {
                ...state,
                cancelled: event.cancelled,
                results: state.results.map((info) =>
                    info.statementIndex === event.index ? { ...info, complete: true } : info,
                ),
                statements: updateStatement(state, event.index, {
                    status: "failed",
                    message: event.message,
                    errorAt: event.errorAt,
                }),
            };
        case "finished":
            return {
                ...state,
                running: false,
                cancelled: state.cancelled || event.cancelled,
                elapsedMs: event.elapsedMs,
                results: state.results.map((info) => ({ ...info, complete: true })),
                statements: state.statements.map((statement) =>
                    statement.status === "pending" || statement.status === "running"
                        ? { ...statement, status: "skipped" }
                        : statement,
                ),
            };
    }
}

export function failRun(state: RunState, message: string): RunState {
    return { ...state, running: false, error: message };
}

export function firstError(state: RunState): StatementState | undefined {
    return state.statements.find((statement) => statement.status === "failed");
}
