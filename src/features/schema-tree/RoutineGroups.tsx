import { useQuery } from "@tanstack/react-query";
import {
    CalendarClockIcon,
    CogIcon,
    FolderIcon,
    ListOrderedIcon,
    SigmaIcon,
    ZapIcon,
    type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { toast } from "sonner";
import { errorMessage } from "@/api/invoke";
import { listRoutines, routineDdl } from "@/api/schema";
import { useUiStore } from "@/app/uiStore";
import type { Routine } from "@/bindings/Routine";
import type { RoutineKind } from "@/bindings/RoutineKind";
import type { RoutineTarget } from "@/bindings/RoutineTarget";
import type { SessionInfo } from "@/bindings/SessionInfo";
import {
    ContextMenu,
    ContextMenuContent,
    ContextMenuItem,
    ContextMenuSeparator,
    ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { useWorkspace } from "@/features/workspace/workspaceStore";
import { getT, useT } from "@/i18n";

const KIND_ORDER: RoutineKind[] = ["function", "procedure", "trigger", "event", "sequence"];
const KIND_ICONS: Record<RoutineKind, LucideIcon> = {
    function: SigmaIcon,
    procedure: CogIcon,
    trigger: ZapIcon,
    event: CalendarClockIcon,
    sequence: ListOrderedIcon,
};

const ROW =
    "flex h-7 w-full min-w-0 items-center gap-1.5 rounded-md pr-2 text-left text-[13px] text-sidebar-foreground/80 outline-none hover:bg-sidebar-accent/60 hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring";

export function routineLabel(routine: Routine): string {
    return routine.arguments !== null ? `${routine.name}(${routine.arguments})` : routine.name;
}

export function RoutineGroups({
    session,
    database,
    schema,
    level,
    filter,
    indent,
    renderToggle,
}: {
    session: SessionInfo;
    database: string;
    schema: string | null;
    level: number;
    filter: string;
    indent: (level: number) => { paddingLeft: string };
    renderToggle: (props: {
        label: string;
        level: number;
        expandedKey: string;
        icon: ReactNode;
    }) => ReactNode;
}) {
    const t = useT();
    const routines = useQuery({
        queryKey: ["routines", session.sessionId, database, schema],
        queryFn: () => listRoutines(session.sessionId, database, schema),
        staleTime: 60_000,
    });
    const expanded = useUiStore((ui) => ui.expanded);

    if (routines.isError) {
        return (
            <p className="py-1 pr-2 text-xs text-destructive select-text" style={indent(level)}>
                {t.schema.routinesFailed}: {errorMessage(routines.error)}
            </p>
        );
    }
    if (!routines.data) {
        return null;
    }
    const visible = filter
        ? routines.data.filter((routine) => routine.name.toLowerCase().includes(filter))
        : routines.data;

    return (
        <>
            {KIND_ORDER.map((kind) => {
                const items = visible.filter((routine) => routine.kind === kind);
                if (items.length === 0) {
                    return null;
                }
                const expandedKey = `r:${session.sessionId}:${database}:${schema ?? ""}:${kind}`;
                const Icon = KIND_ICONS[kind];
                return (
                    <li key={kind}>
                        {renderToggle({
                            label: `${t.schema.routineGroups[kind]} (${items.length})`,
                            level,
                            expandedKey,
                            icon: (
                                <FolderIcon
                                    aria-hidden
                                    className="size-3.5 shrink-0 text-sidebar-foreground/50"
                                />
                            ),
                        })}
                        {(expanded[expandedKey] ?? false) && (
                            <ul role="group">
                                {items.map((routine) => (
                                    <li
                                        key={`${routine.name}(${routine.arguments ?? ""}):${routine.table ?? ""}`}
                                    >
                                        <RoutineNode
                                            session={session}
                                            target={{ database, schema, routine }}
                                            icon={Icon}
                                            level={level + 1}
                                            indent={indent}
                                        />
                                    </li>
                                ))}
                            </ul>
                        )}
                    </li>
                );
            })}
        </>
    );
}

async function loadDdl(sessionId: string, target: RoutineTarget): Promise<string | null> {
    try {
        return await routineDdl(sessionId, target);
    } catch (error) {
        toast.error(getT().schema.ddlFailed, { description: errorMessage(error) });
        return null;
    }
}

function RoutineNode({
    session,
    target,
    icon: Icon,
    level,
    indent,
}: {
    session: SessionInfo;
    target: RoutineTarget;
    icon: LucideIcon;
    level: number;
    indent: (level: number) => { paddingLeft: string };
}) {
    const t = useT();
    const routine = target.routine;
    const label = routineLabel(routine);
    const hint = routine.table ? t.schema.triggerOn(routine.table) : routine.detail;

    const openDdl = async () => {
        const ddl = await loadDdl(session.sessionId, target);
        if (ddl !== null) {
            useWorkspace.getState().openQueryTab(session.sessionId, target.database, ddl);
        }
    };

    const copy = async (value: string, what: string) => {
        try {
            await navigator.clipboard.writeText(value);
            toast.success(getT().common.copied(what));
        } catch (error) {
            toast.error(getT().common.copyFailed, { description: errorMessage(error) });
        }
    };

    return (
        <ContextMenu>
            <ContextMenuTrigger asChild>
                <button
                    type="button"
                    onClick={() => void openDdl()}
                    className={ROW}
                    style={indent(level)}
                    title={hint ? `${label} · ${hint}` : label}
                >
                    <span aria-hidden className="w-3.5 shrink-0" />
                    <Icon aria-hidden className="size-3.5 shrink-0 text-sidebar-foreground/55" />
                    <span className="min-w-0 truncate">{routine.name}</span>
                    {routine.arguments !== null && (
                        <span className="min-w-0 flex-1 truncate text-sidebar-foreground/45">
                            ({routine.arguments})
                        </span>
                    )}
                    {routine.table && (
                        <span className="min-w-0 flex-1 truncate text-right text-[11px] text-sidebar-foreground/45">
                            {routine.table}
                        </span>
                    )}
                </button>
            </ContextMenuTrigger>
            <ContextMenuContent className="w-56">
                <ContextMenuItem onSelect={() => void openDdl()}>
                    {t.schema.openDdl}
                </ContextMenuItem>
                <ContextMenuItem
                    onSelect={() =>
                        void loadDdl(session.sessionId, target).then((ddl) => {
                            if (ddl !== null) {
                                void copy(ddl, t.schema.ddl);
                            }
                        })
                    }
                >
                    {t.schema.copyDdl}
                </ContextMenuItem>
                <ContextMenuItem onSelect={() => void copy(routine.name, t.schema.name)}>
                    {t.schema.copyName}
                </ContextMenuItem>
                {!session.readOnly && (
                    <>
                        <ContextMenuSeparator />
                        <ContextMenuItem
                            variant="destructive"
                            onSelect={() =>
                                useUiStore.getState().setStructureRequest({
                                    sessionId: session.sessionId,
                                    action: { action: "drop_routine", target },
                                })
                            }
                        >
                            {t.structure.menu.drop}
                        </ContextMenuItem>
                    </>
                )}
            </ContextMenuContent>
        </ContextMenu>
    );
}
