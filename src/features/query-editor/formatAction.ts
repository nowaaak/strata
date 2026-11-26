import { toast } from "sonner";
import { useWorkspace } from "@/features/workspace/workspaceStore";
import { getT } from "@/i18n";
import { editorFor } from "./editorRegistry";

export async function formatQueryTab(tabId: string) {
    const workspace = useWorkspace.getState();
    const tab = workspace.tabs.find((candidate) => candidate.id === tabId);
    const view = editorFor(tabId);
    if (!tab || tab.kind !== "query" || !view) {
        return;
    }
    const session = tab.sessionId ? workspace.sessions[tab.sessionId] : undefined;
    try {
        const { formatEditor, formatterLanguage } = await import("./format");
        formatEditor(view, formatterLanguage(session?.engine ?? "mysql", session?.server.flavor));
        view.focus();
    } catch (error) {
        toast.error(getT().query.formatFailed, {
            description: error instanceof Error ? error.message : String(error),
        });
    }
}
