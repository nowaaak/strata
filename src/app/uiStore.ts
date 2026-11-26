import { create } from "zustand";
import type { ConnectionProfile } from "@/bindings/ConnectionProfile";
import type { DdlAction } from "@/bindings/DdlAction";

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

type UiState = {
    paletteOpen: boolean;
    structureRequest: StructureRequest;
    setStructureRequest: (request: StructureRequest) => void;
    processListSession: string | null;
    setProcessListSession: (sessionId: string | null) => void;
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
    processListSession: null,
    setProcessListSession: (processListSession) => set({ processListSession, paletteOpen: false }),
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
