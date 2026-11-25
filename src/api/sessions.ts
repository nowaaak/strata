import type { SessionInfo } from "@/bindings/SessionInfo";
import { call } from "./invoke";

export const openSession = (profileId: string, password: string | null) =>
    call<SessionInfo>("open_session", { profileId, password });

export const closeSession = (sessionId: string) => call<void>("close_session", { sessionId });

export const listSessions = () => call<SessionInfo[]>("list_sessions");
