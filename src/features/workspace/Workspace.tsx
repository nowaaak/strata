import { QueryTab } from "@/features/query-editor/QueryTab";
import { TableTab } from "@/features/table-view/TableTab";
import { useT } from "@/i18n";
import { DisconnectedTab } from "./DisconnectedTab";
import { TabBar } from "./TabBar";
import { WelcomePanel } from "./WelcomePanel";
import { tabTitle, useWorkspace, type WorkspaceTab } from "./workspaceStore";

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
                        <TabContent tab={tab} />
                    </div>
                ))}
            </div>
        </div>
    );
}
