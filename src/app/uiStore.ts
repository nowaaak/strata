import { create } from "zustand";
import type { Engine } from "@/bindings/Engine";
import type { ConnectionProfile } from "@/bindings/ConnectionProfile";
import type { DdlAction } from "@/bindings/DdlAction";
import type { TableTarget } from "@/bindings/TableTarget";

export type ConnectionDialogState =
    { mode: "create"; group?: string | null } | { mode: "edit"; profile: ConnectionProfile } | null;

const COLLAPSED_GROUPS_KEY = "strata.sidebar.collapsedGroups";

function readCollapsedGroups(): string[] {
    try {
        const value: unknown = JSON.parse(localStorage.getItem(COLLAPSED_GROUPS_KEY) ?? "[]");
        return Array.isArray(value) ? value.filter((entry) => typeof entry === "string") : [];
    } catch {
        return [];
    }
}

function storeCollapsedGroups(groups: string[]) {
    try {
        localStorage.setItem(COLLAPSED_GROUPS_KEY, JSON.stringify(groups));
    } catch {
        return;
    }
}

export type HistoryDialogState = { profileId: string | null; tabId: string | null } | null;

export type HostKeyPrompt = {
    profile: ConnectionProfile;
    fingerprint: string;
    password: string | null;
} | null;

export type StructureRequest = { sessionId: string; action: DdlAction } | null;

export type ExplainRequest = {
    sessionId: string;
    database: string | null;
    sql: string;
    engine: Engine;
    writes: boolean;
} | null;

export type DumpRequest = { sessionId: string; database: string; schema: string | null } | null;

export type ErRequest = { sessionId: string; database: string; schema: string | null } | null;

export type SnippetsDialogState = { tabId: string | null } | null;

export type ImportRequest = { sessionId: string; target: TableTarget } | null;

export type DesignerRequest =
    | { mode: "edit"; sessionId: string; target: TableTarget }
    | { mode: "create"; sessionId: string; database: string; schema: string | null }
    | null;

export type UiState = {
    paletteOpen: boolean;
    structureRequest: StructureRequest;
    setStructureRequest: (request: StructureRequest) => void;
    designerRequest: DesignerRequest;
    setDesignerRequest: (request: DesignerRequest) => void;
    importRequest: ImportRequest;
    setImportRequest: (request: ImportRequest) => void;
    snippetsDialog: SnippetsDialogState;
    setSnippetsDialog: (state: SnippetsDialogState) => void;
    dumpRequest: DumpRequest;
    setDumpRequest: (request: DumpRequest) => void;
    explainRequest: ExplainRequest;
    setExplainRequest: (request: ExplainRequest) => void;
    processListSession: string | null;
    setProcessListSession: (sessionId: string | null) => void;
    serverInfoSession: string | null;
    setServerInfoSession: (sessionId: string | null) => void;
    erRequest: ErRequest;
    setErRequest: (request: ErRequest) => void;
    usersSession: string | null;
    setUsersSession: (sessionId: string | null) => void;
    historyDialog: HistoryDialogState;
    setHistoryDialog: (state: HistoryDialogState) => void;
    hostKeyPrompt: HostKeyPrompt;
    setHostKeyPrompt: (prompt: HostKeyPrompt) => void;
    settingsOpen: boolean;
    connectionDialog: ConnectionDialogState;
    passwordPrompt: ConnectionProfile | null;
    connecting: Record<string, boolean>;
    expanded: Record<string, boolean>;
    collapsedGroups: string[];
    treeFilter: string;
    setPaletteOpen: (open: boolean) => void;
    setSettingsOpen: (open: boolean) => void;
    openConnectionDialog: (state: ConnectionDialogState) => void;
    setPasswordPrompt: (profile: ConnectionProfile | null) => void;
    setConnecting: (profileId: string, connecting: boolean) => void;
    setExpanded: (key: string, expanded: boolean) => void;
    toggleGroup: (group: string) => void;
    renameCollapsedGroup: (from: string, to: string | null) => void;
    setTreeFilter: (filter: string) => void;
};

export const useUiStore = create<UiState>((set, get) => ({
    paletteOpen: false,
    structureRequest: null,
    setStructureRequest: (structureRequest) => set({ structureRequest }),
    designerRequest: null,
    setDesignerRequest: (designerRequest) => set({ designerRequest, paletteOpen: false }),
    importRequest: null,
    setImportRequest: (importRequest) => set({ importRequest, paletteOpen: false }),
    snippetsDialog: null,
    setSnippetsDialog: (snippetsDialog) => set({ snippetsDialog, paletteOpen: false }),
    dumpRequest: null,
    setDumpRequest: (dumpRequest) => set({ dumpRequest, paletteOpen: false }),
    explainRequest: null,
    setExplainRequest: (explainRequest) => set({ explainRequest, paletteOpen: false }),
    processListSession: null,
    setProcessListSession: (processListSession) => set({ processListSession, paletteOpen: false }),
    serverInfoSession: null,
    setServerInfoSession: (serverInfoSession) => set({ serverInfoSession, paletteOpen: false }),
    erRequest: null,
    setErRequest: (erRequest) => set({ erRequest, paletteOpen: false }),
    usersSession: null,
    setUsersSession: (usersSession) => set({ usersSession, paletteOpen: false }),
    historyDialog: null,
    setHistoryDialog: (historyDialog) => set({ historyDialog, paletteOpen: false }),
    hostKeyPrompt: null,
    setHostKeyPrompt: (hostKeyPrompt) => set({ hostKeyPrompt }),
    settingsOpen: false,
    connectionDialog: null,
    passwordPrompt: null,
    connecting: {},
    expanded: {},
    collapsedGroups: readCollapsedGroups(),
    treeFilter: "",
    setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
    setSettingsOpen: (settingsOpen) => set({ settingsOpen, paletteOpen: false }),
    openConnectionDialog: (connectionDialog) => set({ connectionDialog, paletteOpen: false }),
    setPasswordPrompt: (passwordPrompt) => set({ passwordPrompt }),
    setConnecting: (profileId, connecting) =>
        set((state) => ({ connecting: { ...state.connecting, [profileId]: connecting } })),
    setExpanded: (key, expanded) =>
        set((state) => ({ expanded: { ...state.expanded, [key]: expanded } })),
    toggleGroup: (group) => {
        const current = get().collapsedGroups;
        const collapsedGroups = current.includes(group)
            ? current.filter((entry) => entry !== group)
            : [...current, group];
        storeCollapsedGroups(collapsedGroups);
        set({ collapsedGroups });
    },
    renameCollapsedGroup: (from, to) => {
        const current = get().collapsedGroups;
        if (!current.includes(from)) {
            return;
        }
        const collapsedGroups = current
            .filter((entry) => entry !== from)
            .concat(to === null ? [] : [to]);
        storeCollapsedGroups(collapsedGroups);
        set({ collapsedGroups });
    },
    setTreeFilter: (treeFilter) => set({ treeFilter }),
}));

export const treeKey = {
    profile: (profileId: string) => `p:${profileId}`,
    database: (sessionId: string, database: string) => `d:${sessionId}:${database}`,
    schema: (sessionId: string, database: string, schema: string) =>
        `s:${sessionId}:${database}:${schema}`,
};
