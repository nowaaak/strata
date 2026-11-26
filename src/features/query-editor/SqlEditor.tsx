import {
    autocompletion,
    closeBrackets,
    closeBracketsKeymap,
    completionKeymap,
} from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { MySQL, PostgreSQL, sql, type SQLNamespace } from "@codemirror/lang-sql";
import { bracketMatching, indentOnInput } from "@codemirror/language";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { Compartment, EditorState, Prec, StateEffect, StateField } from "@codemirror/state";
import {
    Decoration,
    EditorView,
    drawSelection,
    highlightActiveLine,
    highlightActiveLineGutter,
    keymap,
    lineNumbers,
    placeholder,
    type DecorationSet,
} from "@codemirror/view";
import { useEffect, useMemo, useRef } from "react";
import type { Engine } from "@/bindings/Engine";
import { useSettings } from "@/features/settings/useSettings";
import { getT, useT } from "@/i18n";
import { editorTheme } from "./editorTheme";

const setError = StateEffect.define<number | null>();

const errorField = StateField.define<DecorationSet>({
    create: () => Decoration.none,
    update(value, transaction) {
        let next = value.map(transaction.changes);
        let explicit = false;
        for (const effect of transaction.effects) {
            if (!effect.is(setError)) {
                continue;
            }
            explicit = true;
            next = Decoration.none;
            if (effect.value !== null) {
                const doc = transaction.state.doc;
                const position = Math.min(Math.max(0, effect.value), doc.length);
                const line = doc.lineAt(position);
                const from = position < line.to ? position : line.from;
                const to = line.to;
                if (to > from) {
                    next = Decoration.set([
                        Decoration.mark({ class: "cm-sql-error" }).range(from, to),
                    ]);
                }
            }
        }
        if (transaction.docChanged && !explicit) {
            return Decoration.none;
        }
        return next;
    },
    provide: (field) => EditorView.decorations.from(field),
});

export function showError(view: EditorView, position: number) {
    const anchor = Math.min(Math.max(0, position), view.state.doc.length);
    view.dispatch({
        effects: setError.of(anchor),
        selection: { anchor },
        scrollIntoView: true,
    });
    view.focus();
}

export function clearError(view: EditorView) {
    view.dispatch({ effects: setError.of(null) });
}

function language(
    engine: Engine,
    schema: SQLNamespace | undefined,
    defaultSchema: string | undefined,
) {
    return sql({
        dialect: engine === "postgres" ? PostgreSQL : MySQL,
        schema,
        defaultSchema,
        upperCaseKeywords: true,
    });
}

type SqlEditorProps = {
    initialValue: string;
    engine: Engine;
    schema?: SQLNamespace;
    defaultSchema?: string;
    readOnly?: boolean;
    label: string;
    onChange?: (value: string) => void;
    onRunCurrent?: () => void;
    onRunAll?: () => void;
    onCancel?: () => void;
    onFormat?: () => void;
    onView?: (view: EditorView | null) => void;
};

export function SqlEditor(props: SqlEditorProps) {
    const host = useRef<HTMLDivElement>(null);
    const view = useRef<EditorView | null>(null);
    const latest = useRef(props);
    const languageSlot = useMemo(() => new Compartment(), []);
    const wrapSlot = useMemo(() => new Compartment(), []);
    const placeholderSlot = useMemo(() => new Compartment(), []);
    const placeholderText = useT().query.placeholder;
    const wordWrap = useSettings().data?.editorWordWrap ?? false;
    const initialWrap = useRef(wordWrap);
    const { engine, schema, defaultSchema } = props;

    useEffect(() => {
        latest.current = props;
    });

    useEffect(() => {
        const parent = host.current;
        if (!parent) {
            return;
        }
        const initial = latest.current;
        const shortcuts = Prec.highest(
            keymap.of([
                {
                    key: "Mod-Enter",
                    preventDefault: true,
                    run: () => {
                        latest.current.onRunCurrent?.();
                        return true;
                    },
                },
                {
                    key: "Mod-Shift-Enter",
                    preventDefault: true,
                    run: () => {
                        latest.current.onRunAll?.();
                        return true;
                    },
                },
                {
                    key: "Mod-.",
                    preventDefault: true,
                    run: () => {
                        latest.current.onCancel?.();
                        return true;
                    },
                },
                {
                    key: "Shift-Alt-f",
                    preventDefault: true,
                    run: () => {
                        if (latest.current.readOnly || !latest.current.onFormat) {
                            return false;
                        }
                        latest.current.onFormat();
                        return true;
                    },
                },
            ]),
        );
        const editor = new EditorView({
            parent,
            state: EditorState.create({
                doc: initial.initialValue,
                extensions: [
                    shortcuts,
                    lineNumbers(),
                    highlightActiveLineGutter(),
                    history(),
                    drawSelection(),
                    indentOnInput(),
                    bracketMatching(),
                    closeBrackets(),
                    autocompletion({ icons: false }),
                    highlightActiveLine(),
                    highlightSelectionMatches(),
                    keymap.of([
                        ...closeBracketsKeymap,
                        ...defaultKeymap,
                        ...searchKeymap,
                        ...historyKeymap,
                        ...completionKeymap,
                        indentWithTab,
                    ]),
                    editorTheme,
                    errorField,
                    languageSlot.of(
                        language(initial.engine, initial.schema, initial.defaultSchema),
                    ),
                    EditorState.readOnly.of(initial.readOnly ?? false),
                    EditorView.editable.of(!initial.readOnly),
                    EditorView.contentAttributes.of({ "aria-label": initial.label }),
                    placeholderSlot.of(
                        placeholder(initial.readOnly ? "" : getT().query.placeholder),
                    ),
                    wrapSlot.of(initialWrap.current ? EditorView.lineWrapping : []),
                    EditorView.updateListener.of((update) => {
                        if (update.docChanged) {
                            latest.current.onChange?.(update.state.doc.toString());
                        }
                    }),
                ],
            }),
        });
        view.current = editor;
        initial.onView?.(editor);
        return () => {
            latest.current.onView?.(null);
            view.current = null;
            editor.destroy();
        };
    }, [languageSlot, wrapSlot, placeholderSlot]);

    useEffect(() => {
        view.current?.dispatch({
            effects: wrapSlot.reconfigure(wordWrap ? EditorView.lineWrapping : []),
        });
    }, [wrapSlot, wordWrap]);

    useEffect(() => {
        if (latest.current.readOnly) {
            return;
        }
        view.current?.dispatch({
            effects: placeholderSlot.reconfigure(placeholder(placeholderText)),
        });
    }, [placeholderSlot, placeholderText]);

    useEffect(() => {
        view.current?.dispatch({
            effects: languageSlot.reconfigure(language(engine, schema, defaultSchema)),
        });
    }, [languageSlot, engine, schema, defaultSchema]);

    return <div ref={host} className="h-full min-h-0 overflow-hidden" />;
}
