import type { QueryClient } from "@tanstack/react-query";
import type { DdlAction } from "@/bindings/DdlAction";
import type { TableTarget } from "@/bindings/TableTarget";
import { closeWorkspaceTab } from "@/features/connections/connect";
import { sameTarget, useWorkspace } from "@/features/workspace/workspaceStore";

function tableTabs(profileId: string, matches: (target: TableTarget) => boolean) {
    return useWorkspace
        .getState()
        .tabs.filter(
            (tab) => tab.kind === "table" && tab.profileId === profileId && matches(tab.target),
        );
}

function queryTabs(profileId: string, database: string) {
    return useWorkspace
        .getState()
        .tabs.filter(
            (tab) =>
                tab.kind === "query" && tab.profileId === profileId && tab.database === database,
        );
}

export async function applyStructureChange(
    queryClient: QueryClient,
    sessionId: string,
    action: DdlAction,
) {
    const workspace = useWorkspace.getState();
    const profileId = workspace.sessions[sessionId]?.profileId;
    if (profileId) {
        switch (action.action) {
            case "rename_database":
            case "drop_database": {
                const replacement = action.action === "rename_database" ? action.to : null;
                for (const tab of tableTabs(profileId, (t) => t.database === action.database)) {
                    closeWorkspaceTab(tab.id);
                }
                for (const tab of queryTabs(profileId, action.database)) {
                    workspace.updateQueryTab(tab.id, { database: replacement });
                }
                break;
            }
            case "rename_schema":
            case "drop_schema":
                for (const tab of tableTabs(
                    profileId,
                    (t) => t.database === action.database && t.schema === action.schema,
                )) {
                    closeWorkspaceTab(tab.id);
                }
                break;
            case "rename_object":
                for (const tab of tableTabs(profileId, (t) => sameTarget(t, action.target))) {
                    closeWorkspaceTab(tab.id);
                    useWorkspace
                        .getState()
                        .openTableTab(sessionId, { ...action.target, table: action.to });
                }
                break;
            case "drop_object":
                for (const tab of tableTabs(profileId, (t) => sameTarget(t, action.target))) {
                    closeWorkspaceTab(tab.id);
                }
                break;
            default:
                break;
        }
    }
    await queryClient.invalidateQueries({ predicate: (query) => query.queryKey[1] === sessionId });
}
