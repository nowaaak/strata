import type { AlterOp } from "@/bindings/AlterOp";
import type { NewTable } from "@/bindings/NewTable";
import type { TableDesign } from "@/bindings/TableDesign";
import type { TableTarget } from "@/bindings/TableTarget";
import { call } from "./invoke";

export const tableDesign = (sessionId: string, target: TableTarget) =>
    call<TableDesign>("table_design", { sessionId, target });

export const previewAlter = (sessionId: string, target: TableTarget, ops: AlterOp[]) =>
    call<string[]>("preview_alter", { sessionId, target, ops });

export const applyAlter = (sessionId: string, target: TableTarget, ops: AlterOp[]) =>
    call<string[]>("apply_alter", { sessionId, target, ops });

export const previewCreateTable = (sessionId: string, table: NewTable) =>
    call<string[]>("preview_create_table", { sessionId, table });

export const createTable = (sessionId: string, table: NewTable) =>
    call<string[]>("create_table", { sessionId, table });
