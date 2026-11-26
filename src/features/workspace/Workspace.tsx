import { lazy, Suspense } from "react";
import { useT } from "@/i18n";
import { TabBar } from "./TabBar";
import { WelcomePanel } from "./WelcomePanel";
import { tabTitle, useWorkspace, type WorkspaceTab } from "./workspaceStore";

const QueryTab = lazy(() =>
    import("@/features/query-editor/QueryTab").then((module) => ({ default: module.QueryTab })),
);
const TableTab = lazy(() =>
    import("@/features/table-view/TableTab").then((module) => ({ default: module.TableTab })),
);
const DisconnectedTab = lazy(() =>
    import("./DisconnectedTab").then((module) => ({ default: module.DisconnectedTab })),
);

function TabContent({ tab }: { tab: WorkspaceTab }) {
    const connected = useWorkspace((state) =>
        tab.sessionId ? state.sessions[tab.sessionId] !== undefined : false,
    );
    const sessionId = tab.sessionId;
    if (!connected || !sessionId) {
        return <DisconnectedTab tab={tab} />;
    }
    return tab.kind === "query" ? (
        <QueryTab tab={{ ...tab, sessionId }} />
    ) : (
        <TableTab tab={{ ...tab, sessionId }} />
    );
}

export function Workspace() {
    const t = useT();
    const tabs = useWorkspace((state) => state.tabs);
    const activeTabId = useWorkspace((state) => state.activeTabId);

    if (tabs.length === 0) {
        return <WelcomePanel />;
    }

    return (
        <div className="flex h-full min-h-0 flex-col">
            <TabBar />
            <div className="relative min-h-0 flex-1">
                {tabs.map((tab) => (
                    <div
                        key={tab.id}
                        role="tabpanel"
                        aria-label={tabTitle(tab, t)}
                        hidden={tab.id !== activeTabId}
                        className="absolute inset-0"
                    >
                        <Suspense fallback={null}>
                            <TabContent tab={tab} />
                        </Suspense>
                    </div>
                ))}
            </div>
        </div>
    );
}
