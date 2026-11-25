import { useEffect } from "react";
import { toast } from "sonner";
import { errorMessage } from "@/api/invoke";
import { listSessions } from "@/api/sessions";
import { loadWorkspace, saveWorkspace } from "@/api/workspace";
import { getT } from "@/i18n";
import { toSaved, useWorkspace } from "./workspaceStore";

const SAVE_DELAY_MS = 400;

let started = false;
let timer: number | undefined;

export function flushWorkspace() {
    window.clearTimeout(timer);
    timer = undefined;
    const state = useWorkspace.getState();
    if (!state.hydrated) {
        return;
    }
    saveWorkspace(toSaved(state)).catch((error: unknown) =>
        toast.error(getT().app.workspace.saveFailed, {
            id: "workspace-save",
            description: errorMessage(error),
        }),
    );
}

function scheduleSave() {
    window.clearTimeout(timer);
    timer = window.setTimeout(flushWorkspace, SAVE_DELAY_MS);
}

async function start() {
    try {
        useWorkspace.getState().hydrate(await loadWorkspace());
    } catch (error) {
        toast.error(getT().app.workspace.loadFailed, { description: errorMessage(error) });
    }
    try {
        for (const session of await listSessions()) {
            const workspace = useWorkspace.getState();
            workspace.addSession(session);
            workspace.attachProfile(session.profileId, session.sessionId);
        }
    } catch (error) {
        toast.error(getT().connections.toast.restoreFailed, { description: errorMessage(error) });
    }
    useWorkspace.subscribe((state, previous) => {
        if (
            state.hydrated &&
            (state.tabs !== previous.tabs ||
                state.activeTabId !== previous.activeTabId ||
                state.queryCounter !== previous.queryCounter)
        ) {
            scheduleSave();
        }
    });
    window.addEventListener("beforeunload", flushWorkspace);
    window.addEventListener("blur", flushWorkspace);
}

export function useWorkspaceStartup() {
    useEffect(() => {
        if (started) {
            return;
        }
        started = true;
        void start();
    }, []);
}
