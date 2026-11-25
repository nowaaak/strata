import type { HistoryEntry } from "@/bindings/HistoryEntry";
import { call } from "./invoke";

export const historyKey = ["history"] as const;

export const listHistory = (profileId: string | null, search: string, limit = 300) =>
    call<HistoryEntry[]>("list_history", { profileId, search: search || null, limit });

export const deleteHistoryEntry = (id: string) => call<void>("delete_history_entry", { id });

export const clearHistory = (profileId: string | null) =>
    call<number>("clear_history", { profileId });
