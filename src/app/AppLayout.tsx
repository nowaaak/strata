import { useEffect } from "react";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { closeWorkspaceTab } from "@/features/connections/connect";
import { ConnectionsSidebar } from "@/features/connections/ConnectionsSidebar";
import { useProfiles } from "@/features/connections/useProfiles";
import { Workspace } from "@/features/workspace/Workspace";
import { tabTitle, useWorkspace } from "@/features/workspace/workspaceStore";
import { useT } from "@/i18n";
import { TitleBar } from "./TitleBar";
import { useUiStore } from "./uiStore";

function useBreadcrumb(): string[] {
    const t = useT();
    const tab = useWorkspace((state) =>
        state.tabs.find((candidate) => candidate.id === state.activeTabId),
    );
    const profiles = useProfiles().data;
    if (!tab) {
        return [];
    }
    const profile = profiles?.find((candidate) => candidate.id === tab.profileId)?.name ?? "";
    if (tab.kind === "table") {
        const { database, schema, table } = tab.target;
        return [profile, schema ? `${database}.${schema}` : database, table];
    }
    const title = tabTitle(tab, t);
    return tab.database ? [profile, tab.database, title] : [profile, title];
}

function useGlobalShortcuts() {
    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) {
                return;
            }
            const key = event.key.toLowerCase();
            if (key === "h") {
                event.preventDefault();
                const state = useWorkspace.getState();
                const active = state.tabs.find((tab) => tab.id === state.activeTabId);
                useUiStore.getState().setHistoryDialog({
                    profileId: active?.profileId ?? null,
                    tabId: active?.kind === "query" ? active.id : null,
                });
                return;
            }
            if (key === ",") {
                event.preventDefault();
                useUiStore.getState().setSettingsOpen(true);
                return;
            }
            const state = useWorkspace.getState();
            const active = state.tabs.find((tab) => tab.id === state.activeTabId);
            if (key === "t") {
                event.preventDefault();
                const session = active?.sessionId ?? Object.keys(state.sessions)[0];
                if (session) {
                    const database =
                        active?.kind === "query"
                            ? active.database
                            : (active?.target.database ?? null);
                    state.openQueryTab(session, database);
                }
            } else if (key === "w" && active) {
                event.preventDefault();
                closeWorkspaceTab(active.id);
            }
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, []);
}

export function AppLayout() {
    const breadcrumb = useBreadcrumb();
    useGlobalShortcuts();

    return (
        <div className="grid h-full grid-rows-[2.5rem_minmax(0,1fr)] bg-sidebar text-foreground">
            <TitleBar breadcrumb={breadcrumb} />
            <ResizablePanelGroup orientation="horizontal" className="min-h-0">
                <ResizablePanel defaultSize={264} minSize={200} maxSize={520}>
                    <ConnectionsSidebar />
                </ResizablePanel>
                <ResizableHandle className="w-1 bg-transparent after:w-2 hover:bg-primary/30" />
                <ResizablePanel minSize={400}>
                    <main className="h-full min-h-0 overflow-hidden rounded-tl-2xl border-t border-l border-border bg-background">
                        <Workspace />
                    </main>
                </ResizablePanel>
            </ResizablePanelGroup>
        </div>
    );
}
