import type { ServerInfoKind } from "@/bindings/ServerInfoKind";
import type { ServerSetting } from "@/bindings/ServerSetting";
import type { VariableChange } from "@/bindings/VariableChange";
import { call } from "./invoke";

export const serverInfo = (sessionId: string, kind: ServerInfoKind) =>
    call<ServerSetting[]>("server_info", { sessionId, kind });

export const previewServerVariable = (sessionId: string, change: VariableChange) =>
    call<string[]>("preview_server_variable", { sessionId, change });

export const setServerVariable = (sessionId: string, change: VariableChange) =>
    call<string[]>("set_server_variable", { sessionId, change });
