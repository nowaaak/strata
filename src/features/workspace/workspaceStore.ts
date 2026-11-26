import { create } from "zustand";
import type { SavedTab } from "@/bindings/SavedTab";
import type { SavedWorkspace } from "@/bindings/SavedWorkspace";
import type { SessionInfo } from "@/bindings/SessionInfo";
import type { TableTarget } from "@/bindings/TableTarget";
import type { Messages } from "@/i18n";

export type QueryTab = {
    id: string;
    kind: "query";
    sessionId: string | null;
    profileId: string;
    number: number;
    database: string | null;
    sql: string;
};

export type TableTab = {
    id: string;
    kind: "table";
    sessionId: string | null;
    profileId: string;
    title: string;
    target: TableTarget;
    filter?: { value: string; nonce: number };
};

export type WorkspaceTab = QueryTab | TableTab;

export type Attached<T extends WorkspaceTab> = T & { sessionId: string };

export function tabTitle(tab: WorkspaceTab, t: Messages): string {
    return tab.kind === "query" ? t.app.tabs.queryTitle(tab.number) : tab.title;
}

type WorkspaceState = {
    hydrated: boolean;
    sessions: Record<string, SessionInfo>;
    tabs: WorkspaceTab[];
    activeTabId: string | null;
    queryCounter: number;
    hydrate: (saved: SavedWorkspace) => void;
    addSession: (session: SessionInfo) => void;
    attachProfile: (profileId: string, sessionId: string) => number;
    removeSession: (sessionId: string) => WorkspaceTab[];
    removeProfileTabs: (profileId: string) => void;
    openQueryTab: (sessionId: string, database: string | null, sql?: string) => string | null;
    openProfileQueryTab: (profileId: string, database: string | null, sql: string) => string;
    openTableTab: (sessionId: string, target: TableTarget, filter?: string) => string | null;
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

function fromSaved(tab: SavedTab): WorkspaceTab {
    return { ...tab, sessionId: null };
}

export function toSaved(
    state: Pick<WorkspaceState, "tabs" | "activeTabId" | "queryCounter">,
): SavedWorkspace {
    return {
        tabs: state.tabs.map((tab): SavedTab => {
            if (tab.kind === "query") {
                const { id, profileId, number, database, sql } = tab;
                return { kind: "query", id, profileId, number, database, sql };
            }
            const { id, profileId, title, target } = tab;
            return { kind: "table", id, profileId, title, target };
        }),
        activeTabId: state.activeTabId,
        queryCounter: state.queryCounter,
    };
}

export const useWorkspace = create<WorkspaceState>((set, get) => ({
    hydrated: false,
    sessions: {},
    tabs: [],
    activeTabId: null,
    queryCounter: 0,

    hydrate: (saved) => {
        const tabs = saved.tabs.map(fromSaved);
        const active = tabs.some((tab) => tab.id === saved.activeTabId)
            ? saved.activeTabId
            : (tabs.at(-1)?.id ?? null);
        set({ hydrated: true, tabs, activeTabId: active, queryCounter: saved.queryCounter });
    },

    addSession: (session) =>
        set((state) => ({ sessions: { ...state.sessions, [session.sessionId]: session } })),

    attachProfile: (profileId, sessionId) => {
        set((state) => ({
            tabs: state.tabs.map((tab) =>
                tab.profileId === profileId ? { ...tab, sessionId } : tab,
            ),
        }));
        return get().tabs.filter((tab) => tab.profileId === profileId).length;
    },

    removeSession: (sessionId) => {
        const state = get();
        const detached = state.tabs.filter((tab) => tab.sessionId === sessionId);
        const sessions = { ...state.sessions };
        delete sessions[sessionId];
        set({
            sessions,
            tabs: state.tabs.map((tab) =>
                tab.sessionId === sessionId ? { ...tab, sessionId: null } : tab,
            ),
        });
        return detached;
    },

    removeProfileTabs: (profileId) => {
        const state = get();
        const tabs = state.tabs.filter((tab) => tab.profileId !== profileId);
        const activeStillOpen = tabs.some((tab) => tab.id === state.activeTabId);
        set({
            tabs,
            activeTabId: activeStillOpen ? state.activeTabId : (tabs.at(-1)?.id ?? null),
        });
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

    openProfileQueryTab: (profileId, database, sql) => {
        const session = sessionForProfile(get().sessions, profileId);
        const counter = get().queryCounter + 1;
        const tab: QueryTab = {
            id: crypto.randomUUID(),
            kind: "query",
            sessionId: session?.sessionId ?? null,
            profileId,
            number: counter,
            database,
            sql,
        };
        set((state) => ({
            tabs: [...state.tabs, tab],
            activeTabId: tab.id,
            queryCounter: counter,
        }));
        return tab.id;
    },

    openTableTab: (sessionId, target, filter) => {
        const state = get();
        const session = state.sessions[sessionId];
        if (!session) {
            return null;
        }
        const existing = state.tabs.find(
            (tab) =>
                tab.kind === "table" &&
                tab.profileId === session.profileId &&
                sameTarget(tab.target, target),
        );
        const filterRequest =
            filter === undefined ? undefined : { value: filter, nonce: Date.now() };
        if (existing) {
            set({
                activeTabId: existing.id,
                tabs: state.tabs.map((tab) =>
                    tab.id === existing.id
                        ? { ...tab, sessionId, ...(filterRequest ? { filter: filterRequest } : {}) }
                        : tab,
                ),
            });
            return existing.id;
        }
        const tab: TableTab = {
            id: crypto.randomUUID(),
            kind: "table",
            sessionId,
            profileId: session.profileId,
            title: target.table,
            target,
            ...(filterRequest ? { filter: filterRequest } : {}),
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
