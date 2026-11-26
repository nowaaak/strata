import { useMemo } from "react";
import { useT } from "@/i18n";
import { displayShortcut, effectiveShortcuts, type ShortcutAction } from "@/lib/shortcuts";
import { useSettings } from "./useSettings";

export function useShortcuts() {
    const overrides = useSettings().data?.shortcuts;
    return useMemo(() => effectiveShortcuts(overrides), [overrides]);
}

export function useShortcutLabel() {
    const t = useT();
    const shortcuts = useShortcuts();
    return (action: ShortcutAction) => displayShortcut(shortcuts[action], t.common.ctrl);
}
