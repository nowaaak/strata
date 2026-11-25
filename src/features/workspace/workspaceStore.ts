import { create } from "zustand";
import type { SessionInfo } from "@/bindings/SessionInfo";
import type { TableTarget } from "@/bindings/TableTarget";
import type { Messages } from "@/i18n";

export type QueryTab = {
    id: string;
    kind: "query";
    sessionId: string;
    profileId: string;
    number: number;
    database: string | null;
    sql: string;
};

export type TableTab = {
    id: string;
    kind: "table";
    sessionId: string;
    profileId: string;
    title: string;
    target: TableTarget;
};

export type WorkspaceTab = QueryTab | TableTab;

export function tabTitle(tab: WorkspaceTab, t: Messages): string {
    return tab.kind === "query" ? t.app.tabs.queryTitle(tab.number) : tab.title;
}

type WorkspaceState = {
    sessions: Record<string, SessionInfo>;
    tabs: WorkspaceTab[];
    activeTabId: string | null;
    queryCounter: number;
    addSession: (session: SessionInfo) => void;
    removeSession: (sessionId: string) => WorkspaceTab[];
    openQueryTab: (sessionId: string, database: string | null, sql?: string) => string | null;
    openTableTab: (sessionId: string, target: TableTarget) => string | null;
    closeTab: (tabId: string) => WorkspaceTab | undefined;
    activate: (tabId: string) => void;
    updateQueryTab: (tabId: string, patch: Partial<Pick<QueryTab, "sql" | "database">>) => void;
};

export function sameTarget(a: TableTarget, b: TableTarget): boolean {
    return a.database === b.database && a.schema === b.schema && a.table === b.table;
}

function neighbour(tabs: WorkspaceTab[], index: number): string | null {
    return (tabs[index] ?? tabs[index - 1])?.id ?? null;
}

export const useWorkspace = create<WorkspaceState>((set, get) => ({
    sessions: {},
    tabs: [],
    activeTabId: null,
    queryCounter: 0,

    addSession: (session) =>
        set((state) => ({ sessions: { ...state.sessions, [session.sessionId]: session } })),

    removeSession: (sessionId) => {
        const state = get();
        const removed = state.tabs.filter((tab) => tab.sessionId === sessionId);
        const tabs = state.tabs.filter((tab) => tab.sessionId !== sessionId);
        const sessions = { ...state.sessions };
        delete sessions[sessionId];
        const activeStillOpen = tabs.some((tab) => tab.id === state.activeTabId);
        set({
            sessions,
            tabs,
            activeTabId: activeStillOpen ? state.activeTabId : (tabs.at(-1)?.id ?? null),
        });
        return removed;
    },

    openQueryTab: (sessionId, database, sql = "") => {
        const session = get().sessions[sessionId];
        if (!session) {
            return null;
        }
        const counter = get().queryCounter + 1;
        const tab: QueryTab = {
            id: crypto.randomUUID(),
            kind: "query",
            sessionId,
            profileId: session.profileId,
            number: counter,
            database: database ?? session.server.database,
            sql,
        };
        set((state) => ({
            tabs: [...state.tabs, tab],
            activeTabId: tab.id,
            queryCounter: counter,
        }));
        return tab.id;
    },

    openTableTab: (sessionId, target) => {
        const state = get();
        const session = state.sessions[sessionId];
        if (!session) {
            return null;
        }
        const existing = state.tabs.find(
            (tab) =>
                tab.kind === "table" &&
                tab.sessionId === sessionId &&
                sameTarget(tab.target, target),
        );
        if (existing) {
            set({ activeTabId: existing.id });
            return existing.id;
        }
        const tab: TableTab = {
            id: crypto.randomUUID(),
            kind: "table",
            sessionId,
            profileId: session.profileId,
            title: target.table,
            target,
        };
        set({ tabs: [...state.tabs, tab], activeTabId: tab.id });
        return tab.id;
    },

    closeTab: (tabId) => {
        const state = get();
        const index = state.tabs.findIndex((tab) => tab.id === tabId);
        const tab = state.tabs[index];
        if (!tab) {
            return undefined;
        }
        const tabs = state.tabs.filter((candidate) => candidate.id !== tabId);
        set({
            tabs,
            activeTabId: state.activeTabId === tabId ? neighbour(tabs, index) : state.activeTabId,
        });
        return tab;
    },

    activate: (tabId) => set({ activeTabId: tabId }),

    updateQueryTab: (tabId, patch) =>
        set((state) => ({
            tabs: state.tabs.map((tab) =>
                tab.id === tabId && tab.kind === "query" ? { ...tab, ...patch } : tab,
            ),
        })),
}));

export function sessionForProfile(
    sessions: Record<string, SessionInfo>,
    profileId: string,
): SessionInfo | undefined {
    return Object.values(sessions).find((session) => session.profileId === profileId);
}
