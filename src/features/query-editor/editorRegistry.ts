import type { EditorView } from "@codemirror/view";

const editors = new Map<string, EditorView>();

export function registerEditor(tabId: string, view: EditorView | null) {
    if (view) {
        editors.set(tabId, view);
    } else {
        editors.delete(tabId);
    }
}

export function editorFor(tabId: string): EditorView | undefined {
    return editors.get(tabId);
}
