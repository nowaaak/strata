import { useQueryClient } from "@tanstack/react-query";
import {
    FileCode2Icon,
    MonitorIcon,
    MoonIcon,
    PlugIcon,
    PlusIcon,
    SearchIcon,
    SettingsIcon,
    SunIcon,
    Table2Icon,
    UnplugIcon,
    type LucideIcon,
} from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useUiStore } from "@/app/uiStore";
import type { DbObject } from "@/bindings/DbObject";
import type { Theme } from "@/bindings/Theme";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { requestConnect, useDisconnect } from "@/features/connections/connect";
import { useProfiles } from "@/features/connections/useProfiles";
import { THEMES } from "@/features/settings/theme";
import { useSettings, useUpdateSettings } from "@/features/settings/useSettings";
import { sessionForProfile, useWorkspace } from "@/features/workspace/workspaceStore";
import { useT } from "@/i18n";
import { fuzzyScore } from "@/lib/fuzzy";
import { cn } from "@/lib/utils";

type Group = "tables" | "connections" | "actions";

const GROUP_ORDER: Group[] = ["tables", "connections", "actions"];
const MAX_TABLES = 200;

type Command = {
    id: string;
    label: string;
    group: Group;
    icon: LucideIcon;
    hint?: string;
    keywords?: string;
    run: () => unknown;
};

const THEME_ICONS: Record<Theme, LucideIcon> = {
    dark: MoonIcon,
    light: SunIcon,
    system: MonitorIcon,
};

function useCommands(): Command[] {
    const t = useT();
    const queryClient = useQueryClient();
    const profiles = useProfiles().data;
    const sessions = useWorkspace((state) => state.sessions);
    const activeTab = useWorkspace((state) =>
        state.tabs.find((tab) => tab.id === state.activeTabId),
    );
    const settings = useSettings().data;
    const updateSettings = useUpdateSettings();
    const disconnect = useDisconnect();

    return useMemo(() => {
        const text = t.palette;
        const commands: Command[] = [];
        for (const [key, objects] of queryClient.getQueriesData<DbObject[]>({
            queryKey: ["objects"],
        })) {
            const [, sessionId, database, schema] = key as [string, string, string, string | null];
            const session = sessions[sessionId];
            if (!session || !objects) {
                continue;
            }
            const profile = profiles?.find((candidate) => candidate.id === session.profileId);
            for (const object of objects) {
                const path = schema
                    ? `${database}.${schema}.${object.name}`
                    : `${database}.${object.name}`;
                commands.push({
                    id: `table:${sessionId}:${path}`,
                    label: object.name,
                    group: "tables",
                    icon: Table2Icon,
                    hint: profile ? `${profile.name} · ${schema ?? database}` : path,
                    keywords: path,
                    run: () =>
                        useWorkspace
                            .getState()
                            .openTableTab(sessionId, { database, schema, table: object.name }),
                });
            }
        }
        for (const profile of profiles ?? []) {
            const session = sessionForProfile(sessions, profile.id);
            if (session) {
                commands.push(
                    {
                        id: `query:${profile.id}`,
                        label: text.newQueryFor(profile.name),
                        group: "connections",
                        icon: FileCode2Icon,
                        keywords: profile.group ?? undefined,
                        run: () =>
                            useWorkspace
                                .getState()
                                .openQueryTab(session.sessionId, session.server.database),
                    },
                    {
                        id: `disconnect:${profile.id}`,
                        label: text.disconnect(profile.name),
                        group: "connections",
                        icon: UnplugIcon,
                        keywords: profile.group ?? undefined,
                        run: () => disconnect(session.sessionId),
                    },
                );
            } else {
                commands.push({
                    id: `connect:${profile.id}`,
                    label: text.connect(profile.name),
                    group: "connections",
                    icon: PlugIcon,
                    hint: profile.group ?? `${profile.host}:${profile.port}`,
                    keywords: profile.group ?? undefined,
                    run: () => requestConnect(profile),
                });
            }
        }
        commands.push(
            {
                id: "new-connection",
                label: text.newConnection,
                group: "actions",
                icon: PlusIcon,
                run: () => useUiStore.getState().openConnectionDialog({ mode: "create" }),
            },
            {
                id: "settings",
                label: text.settings,
                group: "actions",
                icon: SettingsIcon,
                hint: `${t.common.ctrl}+,`,
                run: () => useUiStore.getState().setSettingsOpen(true),
            },
        );
        if (activeTab) {
            commands.push({
                id: "new-query",
                label: text.newQueryHere,
                group: "actions",
                icon: FileCode2Icon,
                hint: `${t.common.ctrl}+T`,
                run: () =>
                    useWorkspace
                        .getState()
                        .openQueryTab(
                            activeTab.sessionId,
                            activeTab.kind === "query"
                                ? activeTab.database
                                : activeTab.target.database,
                        ),
            });
        }
        if (settings) {
            for (const theme of THEMES) {
                commands.push({
                    id: `theme:${theme}`,
                    label: text.theme(t.settings.themes[theme]),
                    group: "actions",
                    icon: THEME_ICONS[theme],
                    hint: settings.theme === theme ? text.active : undefined,
                    run: () => updateSettings.mutate({ ...settings, theme }),
                });
            }
        }
        return commands;
    }, [t, queryClient, profiles, sessions, activeTab, settings, updateSettings, disconnect]);
}

function rank(commands: Command[], query: string): { group: Group; items: Command[] }[] {
    const scored = commands.flatMap((command) => {
        const label = fuzzyScore(query, command.label);
        const extended = fuzzyScore(query, `${command.label} ${command.keywords ?? ""}`);
        const score = Math.max(label ?? -1, extended === null ? -1 : extended * 0.8);
        return score < 0 ? [] : [{ command, score }];
    });
    return GROUP_ORDER.map((group) => {
        const items = scored
            .filter((entry) => entry.command.group === group)
            .sort((a, b) => b.score - a.score)
            .map((entry) => entry.command);
        return {
            group,
            items: group === "tables" ? items.slice(0, query.trim() ? MAX_TABLES : 8) : items,
        };
    }).filter((section) => section.items.length > 0);
}

export function CommandPalette() {
    const t = useT();
    const open = useUiStore((state) => state.paletteOpen);
    const setOpen = useUiStore((state) => state.setPaletteOpen);

    useEffect(() => {
        const onKeyDown = (event: globalThis.KeyboardEvent) => {
            if (
                (event.ctrlKey || event.metaKey) &&
                !event.altKey &&
                !event.shiftKey &&
                event.key.toLowerCase() === "k"
            ) {
                event.preventDefault();
                setOpen(!useUiStore.getState().paletteOpen);
            }
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [setOpen]);

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogContent
                showCloseButton={false}
                className="top-[12%] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-xl"
            >
                <DialogTitle className="sr-only">{t.palette.title}</DialogTitle>
                <DialogDescription className="sr-only">{t.palette.description}</DialogDescription>
                {open && <Palette onClose={() => setOpen(false)} />}
            </DialogContent>
        </Dialog>
    );
}

function Palette({ onClose }: { onClose: () => void }) {
    const t = useT();
    const text = t.palette;
    const commands = useCommands();
    const [query, setQuery] = useState("");
    const [active, setActive] = useState(0);
    const listRef = useRef<HTMLDivElement>(null);
    const baseId = useId();
    const sections = useMemo(() => rank(commands, query), [commands, query]);
    const flat = sections.flatMap((section) => section.items);
    const activeIndex = flat.length === 0 ? -1 : Math.min(active, flat.length - 1);
    const optionId = (index: number) => `${baseId}-option-${index}`;

    useEffect(() => {
        if (activeIndex >= 0) {
            listRef.current
                ?.querySelector(`[data-index="${activeIndex}"]`)
                ?.scrollIntoView({ block: "nearest" });
        }
    }, [activeIndex]);

    const execute = (command: Command | undefined) => {
        if (!command) {
            return;
        }
        onClose();
        window.setTimeout(() => void command.run(), 0);
    };

    const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
        if (flat.length === 0) {
            return;
        }
        if (event.key === "ArrowDown") {
            event.preventDefault();
            setActive((activeIndex + 1) % flat.length);
        } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActive((activeIndex - 1 + flat.length) % flat.length);
        } else if (event.key === "Enter" && !event.nativeEvent.isComposing) {
            event.preventDefault();
            execute(flat[activeIndex]);
        }
    };

    let index = -1;
    return (
        <div className="flex flex-col">
            <div className="flex items-center gap-2.5 border-b px-4">
                <SearchIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <input
                    autoFocus
                    role="combobox"
                    aria-expanded
                    aria-controls={`${baseId}-list`}
                    aria-activedescendant={activeIndex >= 0 ? optionId(activeIndex) : undefined}
                    aria-autocomplete="list"
                    aria-label={text.input}
                    value={query}
                    placeholder={text.placeholder}
                    spellCheck={false}
                    className="h-12 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                    onChange={(event) => {
                        setQuery(event.target.value);
                        setActive(0);
                    }}
                    onKeyDown={onKeyDown}
                />
            </div>
            <div
                ref={listRef}
                id={`${baseId}-list`}
                role="listbox"
                aria-label={text.results}
                className="h-80 overflow-y-auto p-2"
            >
                {flat.length === 0 ? (
                    <p className="px-3 py-8 text-center text-sm text-muted-foreground">
                        {text.noResults(query.trim())}
                    </p>
                ) : (
                    sections.map((section) => (
                        <div
                            key={section.group}
                            role="group"
                            aria-labelledby={`${baseId}-${section.group}`}
                            className="pb-1"
                        >
                            <p
                                id={`${baseId}-${section.group}`}
                                className="px-3 pt-2 pb-1 text-xs font-medium text-muted-foreground"
                            >
                                {text.groups[section.group]}
                            </p>
                            {section.items.map((command) => {
                                index += 1;
                                const itemIndex = index;
                                const selected = itemIndex === activeIndex;
                                return (
                                    <div
                                        key={command.id}
                                        id={optionId(itemIndex)}
                                        data-index={itemIndex}
                                        role="option"
                                        aria-selected={selected}
                                        className={cn(
                                            "flex h-9 cursor-pointer items-center gap-3 rounded-lg px-3 text-sm select-none",
                                            selected && "bg-accent text-accent-foreground",
                                        )}
                                        onPointerMove={() => !selected && setActive(itemIndex)}
                                        onPointerDown={(event) => event.preventDefault()}
                                        onClick={() => execute(command)}
                                    >
                                        <command.icon
                                            className="size-4 shrink-0 text-muted-foreground"
                                            aria-hidden
                                        />
                                        <span className="min-w-0 flex-1 truncate">
                                            {command.label}
                                        </span>
                                        {command.hint && (
                                            <span className="max-w-48 shrink-0 truncate text-xs text-muted-foreground">
                                                {command.hint}
                                            </span>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    ))
                )}
            </div>
            <div className="flex items-center gap-3 border-t px-4 py-2 text-xs text-muted-foreground">
                <span>{text.footer.select}</span>
                <span>{text.footer.open}</span>
                <span>{text.footer.close}</span>
            </div>
        </div>
    );
}
