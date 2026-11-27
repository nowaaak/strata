import { useEffect, useState } from "react";
import type { Settings } from "@/bindings/Settings";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n";
import {
    DEFAULT_SHORTCUTS,
    SHORTCUT_ACTIONS,
    comboFromEvent,
    conflictOf,
    displayShortcut,
    effectiveShortcuts,
    isUsableShortcut,
    modLabel,
    type ShortcutAction,
} from "@/lib/shortcuts";
import { cn } from "@/lib/utils";

export function ShortcutSettings({
    settings,
    onChange,
}: {
    settings: Settings;
    onChange: (shortcuts: Record<string, string>) => void;
}) {
    const t = useT();
    const text = t.settings.shortcuts;
    const current = effectiveShortcuts(settings.shortcuts);
    const [recording, setRecording] = useState<ShortcutAction | null>(null);
    const [error, setError] = useState<{ action: ShortcutAction; message: string } | null>(null);

    const assign = (action: ShortcutAction, combo: string | null) => {
        const next: Record<string, string> = { ...settings.shortcuts };
        if (combo === null || combo === DEFAULT_SHORTCUTS[action]) {
            delete next[action];
        } else {
            next[action] = combo;
        }
        onChange(next);
    };

    useEffect(() => {
        if (!recording) {
            return;
        }
        const onKeyDown = (event: KeyboardEvent) => {
            event.preventDefault();
            event.stopPropagation();
            if (event.key === "Escape" && !event.ctrlKey && !event.altKey && !event.shiftKey) {
                setRecording(null);
                return;
            }
            const combo = comboFromEvent(event);
            if (!combo) {
                return;
            }
            if (!isUsableShortcut(combo)) {
                setError({ action: recording, message: text.invalid });
                return;
            }
            const taken = conflictOf(current, recording, combo);
            if (taken) {
                setError({ action: recording, message: text.conflict(text.actions[taken]) });
                return;
            }
            setError(null);
            setRecording(null);
            assign(recording, combo);
        };
        window.addEventListener("keydown", onKeyDown, true);
        return () => window.removeEventListener("keydown", onKeyDown, true);
    });

    const changed = Object.keys(settings.shortcuts).length > 0;

    return (
        <div className="flex flex-col gap-3">
            <p className="text-xs text-muted-foreground">{text.intro}</p>
            <ul className="flex flex-col divide-y rounded-lg border">
                {SHORTCUT_ACTIONS.map((action) => {
                    const isRecording = recording === action;
                    const custom = current[action] !== DEFAULT_SHORTCUTS[action];
                    return (
                        <li key={action} className="flex flex-col gap-1 px-3 py-2">
                            <div className="flex items-center gap-3">
                                <span className="min-w-0 flex-1 text-sm">
                                    {text.actions[action]}
                                    {custom && (
                                        <span className="ml-2 text-[11px] text-primary">
                                            {text.changed}
                                        </span>
                                    )}
                                </span>
                                <button
                                    type="button"
                                    aria-label={`${text.actions[action]}: ${displayShortcut(current[action], modLabel(t.common.ctrl))}`}
                                    aria-pressed={isRecording}
                                    onClick={() => {
                                        setError(null);
                                        setRecording(isRecording ? null : action);
                                    }}
                                    className={cn(
                                        "min-w-32 rounded-md border bg-muted px-2 py-1 text-center font-mono text-xs outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring",
                                        isRecording && "border-primary bg-primary/10 text-primary",
                                    )}
                                >
                                    {isRecording
                                        ? text.recording
                                        : displayShortcut(current[action], modLabel(t.common.ctrl))}
                                </button>
                                <Button
                                    variant="ghost"
                                    size="xs"
                                    disabled={!custom}
                                    onClick={() => assign(action, null)}
                                >
                                    {text.reset}
                                </Button>
                            </div>
                            {error?.action === action && (
                                <p role="alert" className="text-xs text-destructive">
                                    {error.message}
                                </p>
                            )}
                        </li>
                    );
                })}
            </ul>
            <Button
                variant="outline"
                size="sm"
                className="self-start"
                disabled={!changed}
                onClick={() => onChange({})}
            >
                {text.resetAll}
            </Button>
        </div>
    );
}
