import { QueryTab } from "@/features/query-editor/QueryTab";
import { TableTab } from "@/features/table-view/TableTab";
import { TabBar } from "./TabBar";
import { WelcomePanel } from "./WelcomePanel";
import { useT } from "@/i18n";
import { tabTitle, useWorkspace } from "./workspaceStore";

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
                        {tab.kind === "query" ? <QueryTab tab={tab} /> : <TableTab tab={tab} />}
                    </div>
                ))}
            </div>
        </div>
    );
}
