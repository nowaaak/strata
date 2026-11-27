import { describe, expect, it } from "vitest";
import {
    DEFAULT_SHORTCUTS,
    comboFromEvent,
    conflictOf,
    displayShortcut,
    effectiveShortcuts,
    isUsableShortcut,
    matchesShortcut,
    normalizeCombo,
    toCodeMirror,
    modLabel,
} from "./shortcuts";

const press = (
    key: string,
    modifiers: Partial<Record<"ctrl" | "shift" | "alt", boolean>> = {},
) => ({
    key,
    ctrlKey: modifiers.ctrl ?? false,
    metaKey: false,
    shiftKey: modifiers.shift ?? false,
    altKey: modifiers.alt ?? false,
});

describe("shortcuts", () => {
    it("normalizes combos into a fixed modifier order", () => {
        expect(normalizeCombo("shift+mod+k")).toBeNull();
        expect(normalizeCombo("Shift+Mod+k")).toBe("Mod+Shift+K");
        expect(normalizeCombo("Alt+Shift+F")).toBe("Shift+Alt+F");
        expect(normalizeCombo("Mod+,")).toBe("Mod+,");
        expect(normalizeCombo("Mod+Hyper+K")).toBeNull();
    });

    it("reads key events, including shifted letters and named keys", () => {
        expect(comboFromEvent(press("K", { ctrl: true, shift: true }))).toBe("Mod+Shift+K");
        expect(comboFromEvent(press("Enter", { ctrl: true }))).toBe("Mod+Enter");
        expect(comboFromEvent(press("Shift", { shift: true }))).toBeNull();
        expect(matchesShortcut(press("f", { shift: true, alt: true }), "Shift+Alt+F")).toBe(true);
        expect(matchesShortcut(press("k", { ctrl: true }), "Mod+Shift+K")).toBe(false);
    });

    it("only accepts combos with Ctrl or Alt, or function keys", () => {
        expect(isUsableShortcut("Mod+E")).toBe(true);
        expect(isUsableShortcut("Alt+1")).toBe(true);
        expect(isUsableShortcut("F5")).toBe(true);
        expect(isUsableShortcut("Shift+A")).toBe(false);
        expect(isUsableShortcut("A")).toBe(false);
    });

    it("merges valid overrides and ignores broken ones", () => {
        const map = effectiveShortcuts({ run: "Mod+R", history: "nonsense+", palette: "A" });
        expect(map.run).toBe("Mod+R");
        expect(map.history).toBe(DEFAULT_SHORTCUTS.history);
        expect(map.palette).toBe(DEFAULT_SHORTCUTS.palette);
    });

    it("finds conflicts with other actions", () => {
        expect(conflictOf(DEFAULT_SHORTCUTS, "run", "Mod+K")).toBe("palette");
        expect(conflictOf(DEFAULT_SHORTCUTS, "palette", "Mod+K")).toBeNull();
        expect(conflictOf(DEFAULT_SHORTCUTS, "run", "Mod+E")).toBeNull();
    });

    it("converts to CodeMirror and display formats", () => {
        expect(toCodeMirror("Mod+Shift+Enter")).toBe("Mod-Shift-Enter");
        expect(toCodeMirror("Shift+Alt+F")).toBe("Shift-Alt-f");
        expect(toCodeMirror("Mod+.")).toBe("Mod-.");
        expect(displayShortcut("Mod+Shift+S", "Strg")).toBe("Strg+⇧+S");
    });

    it("shows the command key on macOS", () => {
        expect(modLabel("Strg", true)).toBe("⌘");
        expect(modLabel("Strg", false)).toBe("Strg");
        expect(displayShortcut("Mod+Shift+S", modLabel("Ctrl", true))).toBe(
            displayShortcut("Mod+Shift+S", "⌘"),
        );
    });
});
