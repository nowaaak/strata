import type { QueryEvent } from "@/bindings/QueryEvent";
import { firstError, reduceRun, startRun, type RunState } from "./runState";

function apply(events: QueryEvent[]): RunState {
    return events.reduce(reduceRun, startRun(1, 5));
}

const plan: QueryEvent = {
    type: "plan",
    statements: [
        { text: "SELECT 1", start: 0, end: 8, writes: false },
        { text: "UPDATE t SET a = 1", start: 10, end: 28, writes: true },
        { text: "SELECT 2", start: 30, end: 38, writes: false },
    ],
};

describe("reduceRun", () => {
    it("tracks streamed results and statement outcomes", () => {
        const state = apply([
            plan,
            { type: "statementStarted", index: 0 },
            {
                type: "columns",
                index: 0,
                result: 0,
                columns: [{ name: "x", typeName: "int", kind: "number" }],
            },
            { type: "progress", index: 0, result: 0, rows: 500 },
        ]);
        expect(state.results[0]).toMatchObject({ rows: 500, complete: false });
        expect(state.statements[0]?.status).toBe("running");
        expect(state.selected).toBe(0);

        const done = [
            {
                type: "statementFinished",
                index: 0,
                elapsedMs: 3,
                outcome: { type: "rows", result: 0, rows: 1000, truncated: true },
            },
            { type: "statementStarted", index: 1 },
            {
                type: "statementFinished",
                index: 1,
                elapsedMs: 1,
                outcome: { type: "affected", rows: 4 },
            },
            { type: "finished", elapsedMs: 9, cancelled: false },
        ] satisfies QueryEvent[];
        const finished = done.reduce(reduceRun, state);
        expect(finished.running).toBe(false);
        expect(finished.results[0]).toMatchObject({ rows: 1000, truncated: true, complete: true });
        expect(finished.statements.map((statement) => statement.status)).toEqual([
            "done",
            "done",
            "skipped",
        ]);
        expect(finished.baseOffset).toBe(5);
    });

    it("records failures with their position and cancellation", () => {
        const state = apply([
            plan,
            { type: "statementStarted", index: 0 },
            {
                type: "statementFailed",
                index: 0,
                message: "boom",
                errorAt: 3,
                cancelled: true,
            },
            { type: "finished", elapsedMs: 2, cancelled: true },
        ]);
        expect(firstError(state)).toMatchObject({ message: "boom", errorAt: 3 });
        expect(state.cancelled).toBe(true);
        expect(state.statements[2]?.status).toBe("skipped");
    });
});
