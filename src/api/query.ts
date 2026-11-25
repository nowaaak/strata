import { Channel } from "@tauri-apps/api/core";
import type { ExportFormat } from "@/bindings/ExportFormat";
import type { QueryEvent } from "@/bindings/QueryEvent";
import type { SqlStatement } from "@/bindings/SqlStatement";
import type { TableQuery } from "@/bindings/TableQuery";
import type { TableTarget } from "@/bindings/TableTarget";
import { call } from "./invoke";

export type Row = (string | null)[];

function channel(onEvent: (event: QueryEvent) => void): Channel<QueryEvent> {
    const events = new Channel<QueryEvent>();
    events.onmessage = onEvent;
    return events;
}

export const splitSql = (sessionId: string, sql: string) =>
    call<SqlStatement[]>("split_sql", { sessionId, sql });

export const executeQuery = (
    sessionId: string,
    tabId: string,
    database: string | null,
    sql: string,
    onEvent: (event: QueryEvent) => void,
) =>
    call<void>("execute_query", {
        sessionId,
        tabId,
        database,
        sql,
        onEvent: channel(onEvent),
    });

export const loadTable = (
    sessionId: string,
    tabId: string,
    target: TableTarget,
    query: TableQuery,
    onEvent: (event: QueryEvent) => void,
) =>
    call<void>("load_table", {
        sessionId,
        tabId,
        target,
        query,
        onEvent: channel(onEvent),
    });

export const cancelQuery = (sessionId: string, tabId: string) =>
    call<void>("cancel_query", { sessionId, tabId });

export const closeTab = (sessionId: string, tabId: string) =>
    call<void>("close_tab", { sessionId, tabId });

export const fetchRows = (
    sessionId: string,
    tabId: string,
    result: number,
    offset: number,
    limit: number,
) => call<Row[]>("fetch_rows", { sessionId, tabId, result, offset, limit });

export const exportResult = (
    sessionId: string,
    tabId: string,
    result: number,
    format: ExportFormat,
    path: string,
) => call<number>("export_result", { sessionId, tabId, result, format, path });
