import type { KillMode } from "@/bindings/KillMode";
import type { ProcessInfo } from "@/bindings/ProcessInfo";
import { call } from "./invoke";

export const listProcesses = (sessionId: string) =>
    call<ProcessInfo[]>("list_processes", { sessionId });

export const killProcess = (sessionId: string, id: string, mode: KillMode) =>
    call<void>("kill_process", { sessionId, id, mode });
