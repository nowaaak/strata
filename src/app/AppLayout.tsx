import { useEffect } from "react";
import { useShortcuts } from "@/features/settings/useShortcuts";
import { matchesShortcut } from "@/lib/shortcuts";
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
    const shortcuts = useShortcuts();
    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (matchesShortcut(event, shortcuts.snippets)) {
                event.preventDefault();
                const state = useWorkspace.getState();
                const active = state.tabs.find((tab) => tab.id === state.activeTabId);
                useUiStore
                    .getState()
                    .setSnippetsDialog({ tabId: active?.kind === "query" ? active.id : null });
                return;
            }
            if (matchesShortcut(event, shortcuts.history)) {
                event.preventDefault();
                const state = useWorkspace.getState();
                const active = state.tabs.find((tab) => tab.id === state.activeTabId);
                useUiStore.getState().setHistoryDialog({
                    profileId: active?.profileId ?? null,
                    tabId: active?.kind === "query" ? active.id : null,
                });
                return;
            }
            if (matchesShortcut(event, shortcuts.settings)) {
                event.preventDefault();
                useUiStore.getState().setSettingsOpen(true);
                return;
            }
            const state = useWorkspace.getState();
            const active = state.tabs.find((tab) => tab.id === state.activeTabId);
            if (matchesShortcut(event, shortcuts.newTab)) {
                event.preventDefault();
                const session = active?.sessionId ?? Object.keys(state.sessions)[0];
                if (session) {
                    const database =
                        active?.kind === "query"
                            ? active.database
                            : (active?.target.database ?? null);
                    state.openQueryTab(session, database);
                }
            } else if (matchesShortcut(event, shortcuts.closeTab) && active) {
                event.preventDefault();
                closeWorkspaceTab(active.id);
            }
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [shortcuts]);
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
