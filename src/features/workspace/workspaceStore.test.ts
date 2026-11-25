import type { SessionInfo } from "@/bindings/SessionInfo";
import { toSaved, useWorkspace } from "./workspaceStore";

function session(sessionId: string, profileId: string): SessionInfo {
    return {
        sessionId,
        profileId,
        engine: "mysql",
        readOnly: false,
        server: { flavor: "MySQL", version: "8.4", database: "shop" },
    };
}

beforeEach(() => {
    useWorkspace.setState({
        hydrated: false,
        sessions: {},
        tabs: [],
        activeTabId: null,
        queryCounter: 0,
    });
});

describe("workspace persistence", () => {
    it("round-trips tabs without session ids and restores them detached", () => {
        const store = useWorkspace.getState();
        store.addSession(session("s1", "p1"));
        const query = store.openQueryTab("s1", null, "SELECT 1");
        store.openTableTab("s1", { database: "shop", schema: null, table: "orders" });
        store.activate(query ?? "");

        const saved = toSaved(useWorkspace.getState());
        expect(JSON.stringify(saved)).not.toContain("s1");
        expect(saved.queryCounter).toBe(1);

        useWorkspace.setState({ sessions: {}, tabs: [], activeTabId: null, queryCounter: 0 });
        useWorkspace.getState().hydrate(saved);
        const restored = useWorkspace.getState();
        expect(restored.hydrated).toBe(true);
        expect(restored.tabs.map((tab) => tab.sessionId)).toEqual([null, null]);
        expect(restored.activeTabId).toBe(query);
        expect(restored.tabs[0]).toMatchObject({
            kind: "query",
            sql: "SELECT 1",
            database: "shop",
        });
    });

    it("reattaches restored tabs when their profile connects again", () => {
        useWorkspace.getState().hydrate({
            tabs: [
                { kind: "query", id: "a", profileId: "p1", number: 1, database: null, sql: "x" },
                { kind: "query", id: "b", profileId: "p2", number: 2, database: null, sql: "y" },
            ],
            activeTabId: "missing",
            queryCounter: 2,
        });
        expect(useWorkspace.getState().activeTabId).toBe("b");

        const store = useWorkspace.getState();
        store.addSession(session("s9", "p1"));
        expect(store.attachProfile("p1", "s9")).toBe(1);
        expect(useWorkspace.getState().tabs.map((tab) => tab.sessionId)).toEqual(["s9", null]);
    });

    it("keeps tabs on disconnect and drops them when the profile is deleted", () => {
        const store = useWorkspace.getState();
        store.addSession(session("s1", "p1"));
        store.openQueryTab("s1", null, "draft");
        const detached = useWorkspace.getState().removeSession("s1");
        expect(detached).toHaveLength(1);
        expect(useWorkspace.getState().tabs[0]?.sessionId).toBeNull();
        expect(useWorkspace.getState().sessions).toEqual({});

        useWorkspace.getState().removeProfileTabs("p1");
        expect(useWorkspace.getState().tabs).toEqual([]);
        expect(useWorkspace.getState().activeTabId).toBeNull();
    });

    it("reuses and reattaches an existing table tab of the same profile", () => {
        useWorkspace.getState().hydrate({
            tabs: [
                {
                    kind: "table",
                    id: "t",
                    profileId: "p1",
                    title: "orders",
                    target: { database: "shop", schema: null, table: "orders" },
                },
            ],
            activeTabId: null,
            queryCounter: 0,
        });
        const store = useWorkspace.getState();
        store.addSession(session("s2", "p1"));
        const id = store.openTableTab("s2", { database: "shop", schema: null, table: "orders" });
        expect(id).toBe("t");
        expect(useWorkspace.getState().tabs).toHaveLength(1);
        expect(useWorkspace.getState().tabs[0]?.sessionId).toBe("s2");
    });
});

describe("opening queries for a profile", () => {
    it("attaches to an open session or creates a detached tab", () => {
        const store = useWorkspace.getState();
        const detached = store.openProfileQueryTab("p1", "shop", "SELECT 1");
        expect(
            useWorkspace.getState().tabs.find((tab) => tab.id === detached)?.sessionId,
        ).toBeNull();

        store.addSession(session("s1", "p1"));
        const attached = useWorkspace.getState().openProfileQueryTab("p1", null, "SELECT 2");
        const tab = useWorkspace.getState().tabs.find((entry) => entry.id === attached);
        expect(tab).toMatchObject({ sessionId: "s1", sql: "SELECT 2", number: 2 });
        expect(useWorkspace.getState().activeTabId).toBe(attached);
    });
});
