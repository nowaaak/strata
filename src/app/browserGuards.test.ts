import { describe, expect, it } from "vitest";
import { isBrowserShortcut, isEditableTarget } from "./browserGuards";

const key = (
    value: string,
    modifiers: Partial<Record<"ctrl" | "alt" | "shift", boolean>> = {},
) => ({
    key: value,
    ctrlKey: modifiers.ctrl ?? false,
    metaKey: false,
    altKey: modifiers.alt ?? false,
    shiftKey: modifiers.shift ?? false,
});

describe("browser guards", () => {
    it("blocks reload, print, save and navigation shortcuts", () => {
        for (const event of [
            key("F5"),
            key("r", { ctrl: true }),
            key("R", { ctrl: true, shift: true }),
            key("p", { ctrl: true }),
            key("s", { ctrl: true }),
            key("ArrowLeft", { alt: true }),
            key("BrowserBack"),
        ]) {
            expect(isBrowserShortcut(event), JSON.stringify(event)).toBe(true);
        }
    });

    it("keeps the shortcuts Strata and the editor use", () => {
        for (const event of [
            key("k", { ctrl: true }),
            key("h", { ctrl: true }),
            key("t", { ctrl: true }),
            key("w", { ctrl: true }),
            key(",", { ctrl: true }),
            key("Enter", { ctrl: true }),
            key("Enter", { ctrl: true, shift: true }),
            key("c", { ctrl: true }),
            key("c", { ctrl: true, shift: true }),
            key("a", { ctrl: true }),
            key("z", { ctrl: true }),
            key("f", { ctrl: true }),
            key("ArrowLeft"),
            key("ArrowLeft", { ctrl: true }),
            key("ArrowLeft", { ctrl: true, alt: true }),
            key("F2"),
        ]) {
            expect(isBrowserShortcut(event), JSON.stringify(event)).toBe(false);
        }
    });

    it("keeps the native menu only in editable elements", () => {
        const input = document.createElement("input");
        const editor = document.createElement("div");
        editor.setAttribute("contenteditable", "true");
        const line = document.createElement("span");
        editor.append(line);
        expect(isEditableTarget(input)).toBe(true);
        expect(isEditableTarget(line)).toBe(true);
        expect(isEditableTarget(document.createElement("button"))).toBe(false);
        expect(isEditableTarget(null)).toBe(false);
    });
});
