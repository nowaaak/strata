import type { DdlAction } from "@/bindings/DdlAction";
import { call } from "./invoke";

export const previewDdl = (sessionId: string, action: DdlAction) =>
    call<string>("preview_ddl", { sessionId, action });

export const runDdl = (sessionId: string, action: DdlAction) =>
    call<string>("run_ddl", { sessionId, action });
