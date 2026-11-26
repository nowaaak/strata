import type { EditorView } from "@codemirror/view";
import { format, type SqlLanguage } from "sql-formatter";
import type { Engine } from "@/bindings/Engine";

export function formatterLanguage(engine: Engine, flavor: string | undefined): SqlLanguage {
    if (engine === "postgres") {
        return "postgresql";
    }
    if (engine === "sqlite") {
        return "sqlite";
    }
    return flavor === "MariaDB" ? "mariadb" : "mysql";
}

export function formatSql(sql: string, language: SqlLanguage): string {
    return format(sql, {
        language,
        tabWidth: 4,
        keywordCase: "upper",
        dataTypeCase: "upper",
        linesBetweenQueries: 1,
    });
}

export function formatEditor(view: EditorView, language: SqlLanguage): boolean {
    const { state } = view;
    const selection = state.selection.main;
    const from = selection.empty ? 0 : selection.from;
    const to = selection.empty ? state.doc.length : selection.to;
    const original = state.sliceDoc(from, to);
    if (original.trim() === "") {
        return false;
    }
    const formatted = formatSql(original, language);
    const trailing = selection.empty && original.endsWith("\n") ? "\n" : "";
    const insert = formatted + trailing;
    if (insert === original) {
        return false;
    }
    view.dispatch({
        changes: { from, to, insert },
        selection: selection.empty ? undefined : { anchor: from, head: from + insert.length },
        scrollIntoView: true,
        userEvent: "input.format",
    });
    return true;
}
