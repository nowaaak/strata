import { PlusIcon } from "lucide-react";
import { useUiStore } from "@/app/uiStore";
import { StrataLogo } from "@/components/brand/StrataLogo";
import { Button } from "@/components/ui/button";
import { useProfiles } from "@/features/connections/useProfiles";
import { useShortcutLabel } from "@/features/settings/useShortcuts";
import { useT } from "@/i18n";

export function WelcomePanel() {
    const t = useT();
    const text = t.app.welcome;
    const shortcut = useShortcutLabel();
    const keys = (label: string) => label.split(/\+(?!$)/);
    const shortcuts = [
        { keys: keys(shortcut("palette")), label: text.palette },
        { keys: keys(shortcut("run")), label: text.runCurrent },
        { keys: keys(shortcut("runAll")), label: text.runAll },
        { keys: keys(shortcut("newTab")), label: text.newQuery },
        { keys: keys(shortcut("settings")), label: text.settings },
    ];
    const profiles = useProfiles();
    const empty = profiles.data?.length === 0;

    return (
        <div className="flex h-full items-center justify-center p-6">
            <div className="flex max-w-sm flex-col items-center gap-5 text-center">
                <StrataLogo size={56} />
                <div className="flex flex-col gap-1.5">
                    <h1 className="text-2xl font-semibold tracking-tight">Strata</h1>
                    <p className="text-sm text-muted-foreground">
                        {empty ? text.empty : text.ready}
                    </p>
                </div>
                {empty && (
                    <Button
                        onClick={() =>
                            useUiStore.getState().openConnectionDialog({ mode: "create" })
                        }
                    >
                        <PlusIcon />
                        {text.newConnection}
                    </Button>
                )}
                <dl className="grid w-full grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2 text-left text-sm">
                    {shortcuts.map((shortcut) => (
                        <div key={shortcut.label} className="contents">
                            <dt className="flex justify-end gap-1">
                                {shortcut.keys.map((key) => (
                                    <kbd
                                        key={key}
                                        className="inline-flex h-5 min-w-5 items-center justify-center rounded border bg-muted px-1 text-[0.6875rem] font-medium"
                                    >
                                        {key}
                                    </kbd>
                                ))}
                            </dt>
                            <dd className="text-muted-foreground">{shortcut.label}</dd>
                        </div>
                    ))}
                </dl>
            </div>
        </div>
    );
}
