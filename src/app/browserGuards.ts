type KeyInfo = Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">;

const MOUSE_BACK = 3;
const MOUSE_FORWARD = 4;
const CTRL_KEYS = new Set(["r", "p", "s", "u", "j", "g", "o", "n"]);
const NAVIGATION_KEYS = new Set(["BrowserBack", "BrowserForward", "BrowserRefresh", "BrowserHome"]);

export function isBrowserShortcut(event: KeyInfo): boolean {
    const ctrl = event.ctrlKey || event.metaKey;
    if (event.key === "F5" || event.key === "F3" || event.key === "F7") {
        return true;
    }
    if (NAVIGATION_KEYS.has(event.key)) {
        return true;
    }
    if (event.altKey && !ctrl && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
        return true;
    }
    return ctrl && !event.altKey && CTRL_KEYS.has(event.key.toLowerCase());
}

export function isEditableTarget(target: EventTarget | null): boolean {
    if (!(target instanceof Element)) {
        return false;
    }
    return target.closest('input, textarea, [contenteditable="true"]') !== null;
}

export function installBrowserGuards(): () => void {
    const onContextMenu = (event: MouseEvent) => {
        if (!isEditableTarget(event.target)) {
            event.preventDefault();
        }
    };
    const onKeyDown = (event: KeyboardEvent) => {
        if (isBrowserShortcut(event)) {
            event.preventDefault();
        }
    };
    const onMouseUp = (event: MouseEvent) => {
        if (event.button === MOUSE_BACK || event.button === MOUSE_FORWARD) {
            event.preventDefault();
        }
    };
    window.addEventListener("contextmenu", onContextMenu);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
        window.removeEventListener("contextmenu", onContextMenu);
        window.removeEventListener("keydown", onKeyDown);
        window.removeEventListener("mouseup", onMouseUp);
    };
}
