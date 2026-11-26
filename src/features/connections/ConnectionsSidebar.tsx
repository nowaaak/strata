import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FolderIcon, PlusIcon, SearchIcon, ServerIcon, SettingsIcon, XIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { errorMessage } from "@/api/invoke";
import { deleteProfile, renameGroup, setProfileGroup } from "@/api/profiles";
import { treeKey, useUiStore } from "@/app/uiStore";
import type { ConnectionProfile } from "@/bindings/ConnectionProfile";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
    ContextMenuItem,
    ContextMenuSeparator,
    ContextMenuSub,
    ContextMenuSubContent,
    ContextMenuSubTrigger,
} from "@/components/ui/context-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { requestStructure, SessionTree, TreeToggle } from "@/features/schema-tree/SchemaTree";
import { UpdateNotice } from "@/features/updater/UpdateNotice";
import { sessionForProfile, useWorkspace } from "@/features/workspace/workspaceStore";
import { getT, useT } from "@/i18n";
import { cn } from "@/lib/utils";
import { requestConnect, useDisconnect } from "./connect";
import { GroupDialog, type GroupDialogState } from "./GroupDialog";
import { groupProfiles } from "./groups";
import { COLOR_CLASSES } from "./labels";
import { profilesKey, useProfiles } from "./useProfiles";

function useGroupActions() {
    const queryClient = useQueryClient();
    const refresh = () => queryClient.invalidateQueries({ queryKey: profilesKey });
    const fail = (error: unknown) =>
        toast.error(getT().connections.group.failed, { description: errorMessage(error) });
    return {
        move: (profileId: string, group: string | null) =>
            setProfileGroup(profileId, group).then(refresh).catch(fail),
        rename: (from: string, to: string | null) =>
            renameGroup(from, to)
                .then(() => {
                    useUiStore.getState().renameCollapsedGroup(from, to);
                    return refresh();
                })
                .catch(fail),
    };
}

export function ConnectionsSidebar() {
    const t = useT();
    const text = t.connections.sidebar;
    const profiles = useProfiles();
    const filter = useUiStore((ui) => ui.treeFilter);
    const collapsed = useUiStore((ui) => ui.collapsedGroups);
    const [deleting, setDeleting] = useState<ConnectionProfile | null>(null);
    const [groupDialog, setGroupDialog] = useState<GroupDialogState>(null);
    const actions = useGroupActions();
    const grouped = groupProfiles(profiles.data ?? []);
    const groupList = grouped.groups.map((group) => group.name);

    const profileNode = (profile: ConnectionProfile, level: number) => (
        <li key={profile.id} role="treeitem" aria-selected={false}>
            <ProfileNode
                profile={profile}
                level={level}
                groups={groupList}
                onDelete={() => setDeleting(profile)}
                onMove={(group) => void actions.move(profile.id, group)}
                onNewGroup={() => setGroupDialog({ mode: "create", profileId: profile.id })}
            />
        </li>
    );

    return (
        <aside aria-label={text.heading} className="flex h-full min-h-0 flex-col gap-2 p-2.5 pt-1">
            <div className="flex items-center justify-between px-1 pt-1">
                <h2 className="px-2 text-[0.6875rem] font-semibold tracking-wider text-sidebar-foreground/50 uppercase">
                    {text.heading}
                </h2>
                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={text.newConnection}
                            onClick={() =>
                                useUiStore.getState().openConnectionDialog({ mode: "create" })
                            }
                        >
                            <PlusIcon />
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent>{text.newConnection}</TooltipContent>
                </Tooltip>
            </div>
            <div className="relative px-1">
                <SearchIcon
                    aria-hidden
                    className="pointer-events-none absolute top-1/2 left-3.5 size-3.5 -translate-y-1/2 text-sidebar-foreground/45"
                />
                <input
                    aria-label={text.filter}
                    placeholder={text.filter}
                    spellCheck={false}
                    value={filter}
                    onChange={(event) => useUiStore.getState().setTreeFilter(event.target.value)}
                    onKeyDown={(event) => {
                        if (event.key === "Escape") {
                            useUiStore.getState().setTreeFilter("");
                        }
                    }}
                    className="h-8 w-full rounded-lg border border-sidebar-border bg-background/40 pr-8 pl-8 text-[13px] outline-none placeholder:text-sidebar-foreground/40 focus-visible:ring-2 focus-visible:ring-sidebar-ring"
                />
                {filter && (
                    <button
                        type="button"
                        aria-label={text.clearFilter}
                        onClick={() => useUiStore.getState().setTreeFilter("")}
                        className="absolute top-1/2 right-3 -translate-y-1/2 rounded p-0.5 text-sidebar-foreground/50 hover:text-sidebar-foreground"
                    >
                        <XIcon className="size-3.5" />
                    </button>
                )}
            </div>
            <ScrollArea className="min-h-0 flex-1">
                {profiles.isPending ? null : profiles.isError ? (
                    <p className="px-3 py-2 text-xs text-destructive select-text">
                        {errorMessage(profiles.error)}
                    </p>
                ) : profiles.data.length === 0 ? (
                    <div className="mx-1 mt-1 flex flex-col items-center gap-3 rounded-xl border border-dashed border-sidebar-border p-4 text-center text-xs text-sidebar-foreground/55">
                        {text.empty}
                        <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                                useUiStore.getState().openConnectionDialog({ mode: "create" })
                            }
                        >
                            <PlusIcon />
                            {text.create}
                        </Button>
                    </div>
                ) : (
                    <ul role="tree" aria-label={text.tree} className="flex flex-col gap-px pb-2">
                        {grouped.ungrouped.map((profile) => profileNode(profile, 0))}
                        {grouped.groups.map((group) => {
                            const open = !collapsed.includes(group.name);
                            return (
                                <li
                                    key={`group:${group.name}`}
                                    role="treeitem"
                                    aria-selected={false}
                                >
                                    <TreeToggle
                                        label={group.name}
                                        level={0}
                                        expanded={open}
                                        onToggle={() =>
                                            useUiStore.getState().toggleGroup(group.name)
                                        }
                                        icon={
                                            <FolderIcon
                                                aria-hidden
                                                className="size-3.5 shrink-0 text-sidebar-foreground/60"
                                            />
                                        }
                                        trailing={
                                            <span
                                                className="shrink-0 text-[11px] text-sidebar-foreground/40 tabular-nums"
                                                title={t.connections.group.count(
                                                    group.profiles.length,
                                                )}
                                            >
                                                {group.profiles.length}
                                            </span>
                                        }
                                        menu={
                                            <>
                                                <ContextMenuItem
                                                    onSelect={() =>
                                                        useUiStore.getState().openConnectionDialog({
                                                            mode: "create",
                                                            group: group.name,
                                                        })
                                                    }
                                                >
                                                    {t.connections.menu.newConnectionInGroup}
                                                </ContextMenuItem>
                                                <ContextMenuSeparator />
                                                <ContextMenuItem
                                                    onSelect={() =>
                                                        setGroupDialog({
                                                            mode: "rename",
                                                            group: group.name,
                                                        })
                                                    }
                                                >
                                                    {t.connections.menu.renameGroup}
                                                </ContextMenuItem>
                                                <ContextMenuItem
                                                    onSelect={() =>
                                                        void actions.rename(group.name, null)
                                                    }
                                                >
                                                    {t.connections.menu.dissolveGroup}
                                                </ContextMenuItem>
                                            </>
                                        }
                                    />
                                    {open && (
                                        <ul role="group" className="flex flex-col gap-px">
                                            {group.profiles.map((profile) =>
                                                profileNode(profile, 1),
                                            )}
                                        </ul>
                                    )}
                                </li>
                            );
                        })}
                    </ul>
                )}
            </ScrollArea>
            <div className="flex flex-col gap-1 border-t border-sidebar-border pt-2">
                <UpdateNotice />
                <button
                    type="button"
                    onClick={() => useUiStore.getState().setSettingsOpen(true)}
                    className="flex h-9 w-full items-center gap-3 rounded-lg px-3 text-sm font-medium text-sidebar-foreground/65 transition-colors outline-none hover:bg-sidebar-accent/50 hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring motion-reduce:transition-none"
                >
                    <SettingsIcon className="size-4" aria-hidden />
                    {text.settings}
                    <kbd className="ml-auto text-[0.6875rem] text-sidebar-foreground/40">
                        {t.common.ctrl}+,
                    </kbd>
                </button>
            </div>
            <DeleteProfileDialog profile={deleting} onClose={() => setDeleting(null)} />
            <GroupDialog
                state={groupDialog}
                onClose={() => setGroupDialog(null)}
                onSubmit={(name) => {
                    if (groupDialog?.mode === "create") {
                        void actions.move(groupDialog.profileId, name);
                    } else if (groupDialog?.mode === "rename") {
                        void actions.rename(groupDialog.group, name);
                    }
                    setGroupDialog(null);
                }}
            />
        </aside>
    );
}

function ProfileNode({
    profile,
    level,
    groups,
    onDelete,
    onMove,
    onNewGroup,
}: {
    profile: ConnectionProfile;
    level: number;
    groups: string[];
    onDelete: () => void;
    onMove: (group: string | null) => void;
    onNewGroup: () => void;
}) {
    const t = useT();
    const menuText = t.connections.menu;
    const session = useWorkspace((state) => sessionForProfile(state.sessions, profile.id));
    const connecting = useUiStore((ui) => ui.connecting[profile.id] ?? false);
    const expandedKey = treeKey.profile(profile.id);
    const expanded = useUiStore((ui) => ui.expanded[expandedKey] ?? false) && session !== undefined;
    const disconnect = useDisconnect();
    const otherGroups = groups.filter((group) => group !== profile.group);

    const toggle = () => {
        if (!session) {
            requestConnect(profile);
            return;
        }
        useUiStore.getState().setExpanded(expandedKey, !expanded);
    };

    const menu = (
        <>
            {session ? (
                <>
                    <ContextMenuItem
                        onSelect={() =>
                            useWorkspace
                                .getState()
                                .openQueryTab(session.sessionId, session.server.database)
                        }
                    >
                        {menuText.newQuery}
                    </ContextMenuItem>
                    {!session.readOnly && (
                        <ContextMenuItem
                            onSelect={() =>
                                requestStructure(session.sessionId, {
                                    action: "create_database",
                                    name: "",
                                })
                            }
                        >
                            {t.structure.menu.newDatabase}
                        </ContextMenuItem>
                    )}
                    <ContextMenuItem
                        onSelect={() =>
                            useUiStore.getState().setProcessListSession(session.sessionId)
                        }
                    >
                        {t.processes.menu}
                    </ContextMenuItem>
                    <ContextMenuItem onSelect={() => void disconnect(session.sessionId)}>
                        {menuText.disconnect}
                    </ContextMenuItem>
                </>
            ) : (
                <ContextMenuItem onSelect={() => requestConnect(profile)}>
                    {menuText.connect}
                </ContextMenuItem>
            )}
            <ContextMenuSeparator />
            <ContextMenuSub>
                <ContextMenuSubTrigger>{menuText.moveToGroup}</ContextMenuSubTrigger>
                <ContextMenuSubContent className="w-52">
                    {otherGroups.map((group) => (
                        <ContextMenuItem key={group} onSelect={() => onMove(group)}>
                            <FolderIcon />
                            {group}
                        </ContextMenuItem>
                    ))}
                    {otherGroups.length > 0 && <ContextMenuSeparator />}
                    <ContextMenuItem onSelect={onNewGroup}>
                        <PlusIcon />
                        {menuText.newGroup}
                    </ContextMenuItem>
                    {profile.group && (
                        <ContextMenuItem onSelect={() => onMove(null)}>
                            {menuText.noGroup}
                        </ContextMenuItem>
                    )}
                </ContextMenuSubContent>
            </ContextMenuSub>
            <ContextMenuItem
                onSelect={() =>
                    useUiStore.getState().openConnectionDialog({ mode: "edit", profile })
                }
            >
                {menuText.edit}
            </ContextMenuItem>
            <ContextMenuItem variant="destructive" onSelect={onDelete}>
                {menuText.delete}
            </ContextMenuItem>
        </>
    );

    const details = session
        ? `${session.server.flavor} ${session.server.version}`
        : `${profile.user}@${profile.host}:${profile.port}`;

    return (
        <div>
            <TreeToggle
                label={profile.name}
                level={level}
                expanded={expanded}
                loading={connecting}
                onToggle={toggle}
                menu={menu}
                icon={
                    <span className="relative flex shrink-0">
                        <ServerIcon
                            aria-hidden
                            className={cn(
                                "size-3.5",
                                session ? "text-sidebar-foreground" : "text-sidebar-foreground/50",
                            )}
                        />
                        <span
                            aria-hidden
                            className={cn(
                                "absolute -right-0.5 -bottom-0.5 size-1.5 rounded-full ring-1 ring-sidebar",
                                COLOR_CLASSES[profile.color],
                                profile.color === "none" && !session && "hidden",
                                profile.color === "none" && session && "bg-emerald-500",
                            )}
                        />
                    </span>
                }
                trailing={
                    <span className="flex shrink-0 items-center gap-1" title={details}>
                        {profile.safety !== "normal" && (
                            <span className="rounded bg-amber-500/15 px-1 text-[10px] font-semibold text-amber-600 uppercase dark:text-amber-400">
                                {profile.safety === "read_only" ? "RO" : "!"}
                            </span>
                        )}
                        <span className="sr-only">
                            {session
                                ? t.connections.sidebar.connected
                                : t.connections.sidebar.disconnected}
                            , {t.connections.safety[profile.safety]}
                        </span>
                    </span>
                }
            />
            {expanded && session && <SessionTree session={session} level={level + 1} />}
        </div>
    );
}

function DeleteProfileDialog({
    profile,
    onClose,
}: {
    profile: ConnectionProfile | null;
    onClose: () => void;
}) {
    const t = useT();
    const text = t.connections.remove;
    const queryClient = useQueryClient();
    const disconnect = useDisconnect();
    const remove = useMutation({
        mutationFn: async (target: ConnectionProfile) => {
            const session = sessionForProfile(useWorkspace.getState().sessions, target.id);
            if (session) {
                await disconnect(session.sessionId);
            }
            await deleteProfile(target.id);
            useWorkspace.getState().removeProfileTabs(target.id);
        },
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: profilesKey });
            onClose();
        },
        onError: (error) =>
            toast.error(getT().connections.remove.failed, { description: errorMessage(error) }),
    });

    return (
        <AlertDialog open={profile !== null} onOpenChange={(open) => !open && onClose()}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>{text.title(profile?.name ?? "")}</AlertDialogTitle>
                    <AlertDialogDescription>{text.description}</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel>{t.common.cancel}</AlertDialogCancel>
                    <AlertDialogAction
                        variant="destructive"
                        disabled={remove.isPending}
                        onClick={(event) => {
                            event.preventDefault();
                            if (profile) {
                                remove.mutate(profile);
                            }
                        }}
                    >
                        {text.confirm}
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}
