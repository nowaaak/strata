import { FileCode2Icon, Loader2Icon, PlusIcon, Table2Icon, UnplugIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { closeWorkspaceTab } from "@/features/connections/connect";
import { COLOR_CLASSES } from "@/features/connections/labels";
import { useProfiles } from "@/features/connections/useProfiles";
import { useRuns } from "@/features/result-grid/runStore";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n";
import { tabTitle, useWorkspace } from "./workspaceStore";

export function TabBar() {
    const t = useT();
    const tabs = useWorkspace((state) => state.tabs);
    const activeTabId = useWorkspace((state) => state.activeTabId);
    const runs = useRuns((state) => state.runs);
    const profiles = useProfiles().data ?? [];
    const active = tabs.find((tab) => tab.id === activeTabId);

    return (
        <div className="flex h-9 shrink-0 items-stretch border-b">
            <div
                role="tablist"
                aria-label={t.app.tabs.label}
                className="flex min-w-0 flex-1 overflow-x-auto"
            >
                {tabs.map((tab) => {
                    const selected = tab.id === activeTabId;
                    const profile = profiles.find((candidate) => candidate.id === tab.profileId);
                    const running = runs[tab.id]?.running ?? false;
                    const detached = tab.sessionId === null;
                    const Icon = detached
                        ? UnplugIcon
                        : tab.kind === "table"
                          ? Table2Icon
                          : FileCode2Icon;
                    const title = tabTitle(tab, t);
                    return (
                        <div
                            key={tab.id}
                            className={cn(
                                "group relative flex max-w-56 shrink-0 items-center border-r text-[13px]",
                                selected
                                    ? "bg-background text-foreground after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-primary"
                                    : "bg-muted/40 text-muted-foreground hover:bg-muted hover:text-foreground",
                            )}
                            onAuxClick={(event) => {
                                if (event.button === 1) {
                                    closeWorkspaceTab(tab.id);
                                }
                            }}
                        >
                            <button
                                type="button"
                                role="tab"
                                aria-selected={selected}
                                title={profile ? `${profile.name} · ${title}` : title}
                                onClick={() => useWorkspace.getState().activate(tab.id)}
                                className="flex h-full min-w-0 items-center gap-2 pr-1 pl-3 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                            >
                                {profile && profile.color !== "none" && (
                                    <span
                                        aria-hidden
                                        className={cn(
                                            "size-1.5 shrink-0 rounded-full",
                                            COLOR_CLASSES[profile.color],
                                        )}
                                    />
                                )}
                                {running ? (
                                    <Loader2Icon
                                        className="size-3.5 shrink-0 animate-spin motion-reduce:animate-none"
                                        aria-hidden
                                    />
                                ) : (
                                    <Icon className="size-3.5 shrink-0" aria-hidden />
                                )}
                                <span className={cn("truncate", detached && "italic opacity-70")}>
                                    {title}
                                </span>
                            </button>
                            <button
                                type="button"
                                aria-label={t.app.tabs.close(title)}
                                onClick={() => closeWorkspaceTab(tab.id)}
                                className={cn(
                                    "mr-1.5 rounded p-0.5 text-muted-foreground opacity-0 outline-none group-hover:opacity-100 hover:bg-foreground/10 hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring",
                                    selected && "opacity-100",
                                )}
                            >
                                <XIcon className="size-3.5" />
                            </button>
                        </div>
                    );
                })}
            </div>
            {active?.sessionId && (
                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={t.app.tabs.newQuery}
                            className="mx-1 self-center"
                            onClick={() => {
                                const database =
                                    active.kind === "query"
                                        ? active.database
                                        : active.target.database;
                                if (active.sessionId) {
                                    useWorkspace
                                        .getState()
                                        .openQueryTab(active.sessionId, database);
                                }
                            }}
                        >
                            <PlusIcon />
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent>{t.app.tabs.newQueryHint}</TooltipContent>
                </Tooltip>
            )}
        </div>
    );
}
