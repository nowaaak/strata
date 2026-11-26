import type { ServerInfoKind } from "@/bindings/ServerInfoKind";
import type { ServerSetting } from "@/bindings/ServerSetting";
import { call } from "./invoke";

export const serverInfo = (sessionId: string, kind: ServerInfoKind) =>
    call<ServerSetting[]>("server_info", { sessionId, kind });
