import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { json } from "@codemirror/lang-json";
import { bracketMatching, foldGutter, foldKeymap, indentOnInput } from "@codemirror/language";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { EditorState, Prec } from "@codemirror/state";
import {
    EditorView,
    drawSelection,
    highlightActiveLine,
    highlightActiveLineGutter,
    keymap,
    lineNumbers,
} from "@codemirror/view";
import { useEffect, useRef } from "react";
import { editorTheme } from "@/features/query-editor/editorTheme";

type JsonEditorProps = {
    value: string;
    label: string;
    onChange: (value: string) => void;
    onSubmit: () => void;
};

export function JsonEditor({ value, label, onChange, onSubmit }: JsonEditorProps) {
    const host = useRef<HTMLDivElement>(null);
    const view = useRef<EditorView | null>(null);
    const latest = useRef({ onChange, onSubmit });

    useEffect(() => {
        latest.current = { onChange, onSubmit };
    });

    useEffect(() => {
        const parent = host.current;
        if (!parent) {
            return;
        }
        const editor = new EditorView({
            parent,
            state: EditorState.create({
                doc: "",
                extensions: [
                    Prec.highest(
                        keymap.of([
                            {
                                key: "Mod-Enter",
                                preventDefault: true,
                                run: () => {
                                    latest.current.onSubmit();
                                    return true;
                                },
                            },
                        ]),
                    ),
                    lineNumbers(),
                    foldGutter(),
                    highlightActiveLineGutter(),
                    history(),
                    drawSelection(),
                    indentOnInput(),
                    bracketMatching(),
                    closeBrackets(),
                    highlightActiveLine(),
                    highlightSelectionMatches(),
                    keymap.of([
                        ...closeBracketsKeymap,
                        ...defaultKeymap,
                        ...searchKeymap,
                        ...historyKeymap,
                        ...foldKeymap,
                        indentWithTab,
                    ]),
                    json(),
                    editorTheme,
                    EditorView.lineWrapping,
                    EditorView.contentAttributes.of({ "aria-label": label }),
                    EditorView.updateListener.of((update) => {
                        if (update.docChanged) {
                            latest.current.onChange(update.state.doc.toString());
                        }
                    }),
                ],
            }),
        });
        view.current = editor;
        editor.focus();
        return () => {
            view.current = null;
            editor.destroy();
        };
    }, [label]);

    useEffect(() => {
        const editor = view.current;
        if (!editor || editor.state.doc.toString() === value) {
            return;
        }
        editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: value } });
    }, [value]);

    return (
        <div
            ref={host}
            className="h-80 min-h-0 overflow-hidden rounded-lg border border-input bg-transparent focus-within:ring-3 focus-within:ring-ring/50 dark:bg-input/30 [&_.cm-editor]:h-full"
        />
    );
}
