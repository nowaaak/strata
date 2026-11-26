import { toast } from "sonner";
import { editorFor } from "@/features/query-editor/editorRegistry";
import { getT } from "@/i18n";

export function editorText(tabId: string | null): string {
    const view = tabId ? editorFor(tabId) : undefined;
    if (!view) {
        return "";
    }
    const selection = view.state.selection.main;
    return selection.empty
        ? view.state.doc.toString()
        : view.state.sliceDoc(selection.from, selection.to);
}

export function insertSnippet(tabId: string | null, sql: string): boolean {
    const view = tabId ? editorFor(tabId) : undefined;
    if (!view) {
        toast.info(getT().snippets.noEditor);
        return false;
    }
    const selection = view.state.selection.main;
    view.dispatch({
        changes: { from: selection.from, to: selection.to, insert: sql },
        selection: { anchor: selection.from + sql.length },
        scrollIntoView: true,
        userEvent: "input.paste",
    });
    view.focus();
    return true;
}
