import type { SchemaGraph } from "@/bindings/SchemaGraph";
import type { CompletionTable } from "@/bindings/CompletionTable";
import type { DbObject } from "@/bindings/DbObject";
import type { Routine } from "@/bindings/Routine";
import type { RoutineTarget } from "@/bindings/RoutineTarget";
import type { TableInfo } from "@/bindings/TableInfo";
import type { TableTarget } from "@/bindings/TableTarget";
import { call } from "./invoke";

export const listDatabases = (sessionId: string) => call<string[]>("list_databases", { sessionId });

export const listSchemas = (sessionId: string, database: string) =>
    call<string[]>("list_schemas", { sessionId, database });

export const listObjects = (sessionId: string, database: string, schema: string | null) =>
    call<DbObject[]>("list_objects", { sessionId, database, schema });

export const schemaGraph = (sessionId: string, database: string, schema: string | null) =>
    call<SchemaGraph>("schema_graph", { sessionId, database, schema });

export const describeTable = (sessionId: string, target: TableTarget) =>
    call<TableInfo>("describe_table", { sessionId, target });

export const tableDdl = (sessionId: string, target: TableTarget) =>
    call<string>("table_ddl", { sessionId, target });

export const completionSchema = (sessionId: string, database: string) =>
    call<CompletionTable[]>("completion_schema", { sessionId, database });

export const listRoutines = (sessionId: string, database: string, schema: string | null) =>
    call<Routine[]>("list_routines", { sessionId, database, schema });

export const routineDdl = (sessionId: string, target: RoutineTarget) =>
    call<string>("routine_ddl", { sessionId, target });

export const equalityFilter = (sessionId: string, columns: string[], values: (string | null)[]) =>
    call<string>("equality_filter", { sessionId, columns, values });
