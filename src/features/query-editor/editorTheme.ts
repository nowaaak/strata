import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { tags } from "@lezer/highlight";

const theme = EditorView.theme({
    "&": {
        height: "100%",
        fontSize: "var(--editor-font-size)",
        backgroundColor: "transparent",
        color: "var(--foreground)",
    },
    ".cm-scroller": {
        fontFamily: "var(--font-mono)",
        lineHeight: "1.55",
    },
    ".cm-content": {
        caretColor: "var(--primary)",
        paddingBlock: "8px",
    },
    ".cm-cursor, .cm-dropCursor": {
        borderLeftColor: "var(--primary)",
        borderLeftWidth: "2px",
    },
    "&.cm-focused": {
        outline: "none",
    },
    ".cm-gutters": {
        backgroundColor: "transparent",
        color: "color-mix(in oklch, var(--muted-foreground) 70%, transparent)",
        border: "none",
    },
    ".cm-activeLineGutter": {
        backgroundColor: "transparent",
        color: "var(--foreground)",
    },
    ".cm-activeLine": {
        backgroundColor: "color-mix(in oklch, var(--foreground) 4%, transparent)",
    },
    "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, ::selection":
        {
            backgroundColor: "color-mix(in oklch, var(--primary) 28%, transparent) !important",
        },
    ".cm-matchingBracket": {
        backgroundColor: "color-mix(in oklch, var(--primary) 22%, transparent)",
        outline: "none",
    },
    ".cm-searchMatch": {
        backgroundColor: "color-mix(in oklch, var(--chart-3) 30%, transparent)",
    },
    ".cm-tooltip": {
        backgroundColor: "var(--popover)",
        color: "var(--popover-foreground)",
        border: "1px solid var(--border)",
        borderRadius: "calc(var(--radius) * 0.8)",
        boxShadow: "0 8px 24px rgb(0 0 0 / 0.25)",
        overflow: "hidden",
    },
    ".cm-tooltip-autocomplete > ul": {
        fontFamily: "var(--font-mono)",
        fontSize: "12.5px",
        maxHeight: "16rem",
    },
    ".cm-tooltip-autocomplete > ul > li": {
        padding: "3px 8px",
    },
    ".cm-tooltip-autocomplete > ul > li[aria-selected]": {
        backgroundColor: "var(--accent)",
        color: "var(--accent-foreground)",
    },
    ".cm-completionDetail": {
        color: "var(--muted-foreground)",
        fontStyle: "normal",
        marginLeft: "0.75em",
    },
    ".cm-panels": {
        backgroundColor: "var(--muted)",
        color: "var(--foreground)",
        borderColor: "var(--border)",
    },
    ".cm-panel input, .cm-panel button": {
        fontFamily: "var(--font-sans)",
        fontSize: "12px",
    },
    ".cm-sql-error": {
        textDecoration: "underline wavy var(--destructive)",
        textUnderlineOffset: "3px",
        backgroundColor: "color-mix(in oklch, var(--destructive) 12%, transparent)",
    },
});

const highlight = HighlightStyle.define([
    {
        tag: [tags.keyword, tags.operatorKeyword, tags.modifier],
        color: "var(--chart-1)",
        fontWeight: "500",
    },
    { tag: [tags.string, tags.special(tags.string)], color: "var(--chart-5)" },
    { tag: [tags.number, tags.bool, tags.null], color: "var(--chart-3)" },
    {
        tag: [tags.lineComment, tags.blockComment],
        color: "var(--muted-foreground)",
        fontStyle: "italic",
    },
    { tag: [tags.typeName, tags.standard(tags.name)], color: "var(--chart-2)" },
    { tag: [tags.special(tags.name), tags.propertyName], color: "var(--chart-4)" },
    {
        tag: [tags.operator, tags.punctuation, tags.bracket],
        color: "color-mix(in oklch, var(--foreground) 70%, transparent)",
    },
]);

export const editorTheme = [theme, syntaxHighlighting(highlight)];
