import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { errorMessage } from "@/api/invoke";
import { closeTab } from "@/api/query";
import { closeSession, openSession } from "@/api/sessions";
import { treeKey, useUiStore } from "@/app/uiStore";
import type { ConnectionProfile } from "@/bindings/ConnectionProfile";
import { useRuns } from "@/features/result-grid/runStore";
import { useWorkspace } from "@/features/workspace/workspaceStore";
import { getT } from "@/i18n";

export async function connectProfile(profile: ConnectionProfile, password: string | null) {
    const ui = useUiStore.getState();
    ui.setConnecting(profile.id, true);
    try {
        const session = await openSession(profile.id, password);
        const workspace = useWorkspace.getState();
        workspace.addSession(session);
        ui.setExpanded(treeKey.profile(profile.id), true);
        const database = session.server.database;
        if (database) {
            ui.setExpanded(treeKey.database(session.sessionId, database), true);
            if (session.engine === "postgres") {
                ui.setExpanded(treeKey.schema(session.sessionId, database, "public"), true);
            }
        }
        if (workspace.attachProfile(profile.id, session.sessionId) === 0) {
            workspace.openQueryTab(session.sessionId, database);
        }
        return session;
    } catch (error) {
        toast.error(getT().connections.toast.connectFailed(profile.name), {
            description: errorMessage(error),
        });
        return null;
    } finally {
        useUiStore.getState().setConnecting(profile.id, false);
    }
}

export function requestConnect(profile: ConnectionProfile) {
    if (profile.askPassword) {
        useUiStore.getState().setPasswordPrompt(profile);
        return;
    }
    void connectProfile(profile, null);
}

export function closeWorkspaceTab(tabId: string) {
    const tab = useWorkspace.getState().closeTab(tabId);
    if (!tab) {
        return;
    }
    useRuns.getState().forget(tabId);
    if (!tab.sessionId) {
        return;
    }
    closeTab(tab.sessionId, tab.id).catch((error: unknown) =>
        toast.error(getT().app.tabs.closeFailed, {
            description: errorMessage(error),
        }),
    );
}

export function useDisconnect() {
    const queryClient = useQueryClient();
    return async (sessionId: string) => {
        const removed = useWorkspace.getState().removeSession(sessionId);
        for (const tab of removed) {
            useRuns.getState().forget(tab.id);
        }
        queryClient.removeQueries({
            predicate: (query) => query.queryKey[1] === sessionId,
        });
        try {
            await closeSession(sessionId);
        } catch (error) {
            toast.error(getT().connections.toast.disconnectFailed, {
                description: errorMessage(error),
            });
        }
    };
}
