export const SHORTCUT_ACTIONS = [
    "palette",
    "run",
    "runAll",
    "cancel",
    "format",
    "newTab",
    "closeTab",
    "history",
    "snippets",
    "settings",
] as const;

export type ShortcutAction = (typeof SHORTCUT_ACTIONS)[number];
export type ShortcutMap = Record<ShortcutAction, string>;

export const DEFAULT_SHORTCUTS: ShortcutMap = {
    palette: "Mod+K",
    run: "Mod+Enter",
    runAll: "Mod+Shift+Enter",
    cancel: "Mod+.",
    format: "Shift+Alt+F",
    newTab: "Mod+T",
    closeTab: "Mod+W",
    history: "Mod+H",
    snippets: "Mod+Shift+S",
    settings: "Mod+,",
};

const MODIFIERS = ["Mod", "Shift", "Alt"] as const;
const NAMED_KEYS = new Set([
    "Enter",
    "Escape",
    "Tab",
    "Space",
    "Backspace",
    "Delete",
    "Insert",
    "Home",
    "End",
    "PageUp",
    "PageDown",
    "ArrowUp",
    "ArrowDown",
    "ArrowLeft",
    "ArrowRight",
]);

function normalizeKey(key: string): string | null {
    if (key === " ") {
        return "Space";
    }
    if (/^F([1-9]|1[0-2])$/.test(key) || NAMED_KEYS.has(key)) {
        return key;
    }
    if (key.length === 1) {
        return key.toUpperCase();
    }
    return null;
}

export function normalizeCombo(combo: string): string | null {
    const parts = combo
        .split("+")
        .map((part) => part.trim())
        .filter((part, index, all) => part !== "" || index === all.length - 1);
    const raw = combo.endsWith("++") ? [...parts.slice(0, -1), "+"] : parts;
    const key = normalizeKey(raw.at(-1) ?? "");
    if (!key) {
        return null;
    }
    const modifiers = new Set(raw.slice(0, -1));
    for (const modifier of modifiers) {
        if (!(MODIFIERS as readonly string[]).includes(modifier)) {
            return null;
        }
    }
    return [...MODIFIERS.filter((modifier) => modifiers.has(modifier)), key].join("+");
}

export function comboFromEvent(
    event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey">,
): string | null {
    if (["Control", "Shift", "Alt", "Meta", "AltGraph"].includes(event.key)) {
        return null;
    }
    const key = normalizeKey(event.key);
    if (!key) {
        return null;
    }
    const parts: string[] = [];
    if (event.ctrlKey || event.metaKey) {
        parts.push("Mod");
    }
    if (event.shiftKey) {
        parts.push("Shift");
    }
    if (event.altKey) {
        parts.push("Alt");
    }
    parts.push(key);
    return parts.join("+");
}

export function matchesShortcut(
    event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey">,
    combo: string,
): boolean {
    const pressed = comboFromEvent(event);
    return pressed !== null && pressed === normalizeCombo(combo);
}

export function isUsableShortcut(combo: string): boolean {
    const normalized = normalizeCombo(combo);
    if (!normalized) {
        return false;
    }
    const parts = normalized.split("+");
    const key = parts.at(-1) ?? "";
    const hasModifier = parts.length > 1 && (parts.includes("Mod") || parts.includes("Alt"));
    return hasModifier || /^F([1-9]|1[0-2])$/.test(key);
}

export function effectiveShortcuts(overrides: Record<string, string> | undefined): ShortcutMap {
    const result = { ...DEFAULT_SHORTCUTS };
    for (const action of SHORTCUT_ACTIONS) {
        const override = overrides?.[action];
        const normalized = override ? normalizeCombo(override) : null;
        if (normalized && isUsableShortcut(normalized)) {
            result[action] = normalized;
        }
    }
    return result;
}

export function conflictOf(
    map: ShortcutMap,
    action: ShortcutAction,
    combo: string,
): ShortcutAction | null {
    const normalized = normalizeCombo(combo);
    return (
        SHORTCUT_ACTIONS.find(
            (other) => other !== action && normalizeCombo(map[other]) === normalized,
        ) ?? null
    );
}

export function toCodeMirror(combo: string): string {
    const normalized = normalizeCombo(combo) ?? combo;
    const parts = normalized.split("+");
    const key = parts.pop() ?? "";
    const cmKey = key.length === 1 ? key.toLowerCase() : key === "Space" ? "Space" : key;
    return [...parts, cmKey].join("-");
}

export function displayShortcut(combo: string, ctrlLabel: string, shiftLabel = "⇧"): string {
    const normalized = normalizeCombo(combo) ?? combo;
    return normalized
        .split("+")
        .map((part) => (part === "Mod" ? ctrlLabel : part === "Shift" ? shiftLabel : part))
        .join("+");
}
