import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
    ChevronRightIcon,
    DatabaseIcon,
    EyeIcon,
    FolderTreeIcon,
    Loader2Icon,
    Table2Icon,
} from "lucide-react";
import type { ReactNode } from "react";
import { toast } from "sonner";
import { errorMessage } from "@/api/invoke";
import { listDatabases, listObjects, listSchemas, tableDdl } from "@/api/schema";
import { treeKey, useUiStore } from "@/app/uiStore";
import type { DbObject } from "@/bindings/DbObject";
import type { SessionInfo } from "@/bindings/SessionInfo";
import type { TableTarget } from "@/bindings/TableTarget";
import {
    ContextMenu,
    ContextMenuContent,
    ContextMenuItem,
    ContextMenuSeparator,
    ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { useWorkspace } from "@/features/workspace/workspaceStore";
import { getT, useT } from "@/i18n";
import { cn } from "@/lib/utils";

const ROW =
    "flex h-7 w-full min-w-0 items-center gap-1.5 rounded-md pr-2 text-left text-[13px] text-sidebar-foreground/80 outline-none hover:bg-sidebar-accent/60 hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring";

export function indent(level: number) {
    return { paddingLeft: `${level * 12 + 6}px` };
}

export function TreeToggle({
    label,
    level,
    expanded,
    loading,
    icon,
    onToggle,
    menu,
    trailing,
}: {
    label: string;
    level: number;
    expanded: boolean;
    loading?: boolean;
    icon: ReactNode;
    onToggle: () => void;
    menu?: ReactNode;
    trailing?: ReactNode;
}) {
    const button = (
        <button
            type="button"
            aria-expanded={expanded}
            onClick={onToggle}
            className={ROW}
            style={indent(level)}
        >
            <ChevronRightIcon
                aria-hidden
                className={cn(
                    "size-3.5 shrink-0 text-sidebar-foreground/50 transition-transform motion-reduce:transition-none",
                    expanded && "rotate-90",
                )}
            />
            {icon}
            <span className="min-w-0 flex-1 truncate">{label}</span>
            {loading && (
                <Loader2Icon className="size-3.5 shrink-0 animate-spin text-sidebar-foreground/50 motion-reduce:animate-none" />
            )}
            {trailing}
        </button>
    );
    if (!menu) {
        return button;
    }
    return (
        <ContextMenu>
            <ContextMenuTrigger asChild>{button}</ContextMenuTrigger>
            <ContextMenuContent className="w-56">{menu}</ContextMenuContent>
        </ContextMenu>
    );
}

function TreeMessage({
    level,
    children,
    error,
}: {
    level: number;
    children: ReactNode;
    error?: boolean;
}) {
    return (
        <p
            className={cn(
                "py-1 pr-2 text-xs text-sidebar-foreground/50",
                error && "text-destructive select-text",
            )}
            style={indent(level + 1)}
        >
            {children}
        </p>
    );
}

function useExpanded(key: string): [boolean, () => void] {
    const expanded = useUiStore((ui) => ui.expanded[key] ?? false);
    const toggle = () => useUiStore.getState().setExpanded(key, !expanded);
    return [expanded, toggle];
}

async function copyText(text: string, what: string) {
    try {
        await navigator.clipboard.writeText(text);
        toast.success(getT().common.copied(what));
    } catch (error) {
        toast.error(getT().common.copyFailed, { description: errorMessage(error) });
    }
}

export function SessionTree({ session, level }: { session: SessionInfo; level: number }) {
    const t = useT();
    const databases = useQuery({
        queryKey: ["databases", session.sessionId],
        queryFn: () => listDatabases(session.sessionId),
        staleTime: 60_000,
    });

    if (databases.isPending) {
        return <TreeMessage level={level}>{t.schema.loadingDatabases}</TreeMessage>;
    }
    if (databases.isError) {
        return (
            <TreeMessage level={level} error>
                {errorMessage(databases.error)}
            </TreeMessage>
        );
    }
    return (
        <ul role="group">
            {databases.data.map((database) => (
                <li key={database}>
                    <DatabaseNode session={session} database={database} level={level} />
                </li>
            ))}
        </ul>
    );
}

function DatabaseNode({
    session,
    database,
    level,
}: {
    session: SessionInfo;
    database: string;
    level: number;
}) {
    const t = useT();
    const queryClient = useQueryClient();
    const [expanded, toggle] = useExpanded(treeKey.database(session.sessionId, database));
    const postgres = session.engine === "postgres";
    const isDefault = session.server.database === database;

    const menu = (
        <>
            <ContextMenuItem
                onSelect={() => useWorkspace.getState().openQueryTab(session.sessionId, database)}
            >
                {t.schema.newQueryHere}
            </ContextMenuItem>
            <ContextMenuItem
                onSelect={() =>
                    void queryClient.invalidateQueries({
                        predicate: (query) =>
                            query.queryKey[1] === session.sessionId &&
                            query.queryKey[2] === database,
                    })
                }
            >
                {t.schema.refresh}
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={() => void copyText(database, t.schema.name)}>
                {t.schema.copyName}
            </ContextMenuItem>
        </>
    );

    return (
        <>
            <TreeToggle
                label={database}
                level={level}
                expanded={expanded}
                onToggle={toggle}
                menu={menu}
                icon={
                    <DatabaseIcon
                        aria-hidden
                        className={cn(
                            "size-3.5 shrink-0",
                            isDefault ? "text-primary" : "text-sidebar-foreground/60",
                        )}
                    />
                }
            />
            {expanded &&
                (postgres ? (
                    <SchemaList session={session} database={database} level={level + 1} />
                ) : (
                    <ObjectList
                        session={session}
                        database={database}
                        schema={null}
                        level={level + 1}
                    />
                ))}
        </>
    );
}

function SchemaList({
    session,
    database,
    level,
}: {
    session: SessionInfo;
    database: string;
    level: number;
}) {
    const t = useT();
    const schemas = useQuery({
        queryKey: ["schemas", session.sessionId, database],
        queryFn: () => listSchemas(session.sessionId, database),
        staleTime: 60_000,
    });
    if (schemas.isPending) {
        return <TreeMessage level={level - 1}>{t.schema.loadingSchemas}</TreeMessage>;
    }
    if (schemas.isError) {
        return (
            <TreeMessage level={level - 1} error>
                {errorMessage(schemas.error)}
            </TreeMessage>
        );
    }
    return (
        <ul role="group">
            {schemas.data.map((schema) => (
                <li key={schema}>
                    <SchemaNode
                        session={session}
                        database={database}
                        schema={schema}
                        level={level}
                    />
                </li>
            ))}
        </ul>
    );
}

function SchemaNode({
    session,
    database,
    schema,
    level,
}: {
    session: SessionInfo;
    database: string;
    schema: string;
    level: number;
}) {
    const [expanded, toggle] = useExpanded(treeKey.schema(session.sessionId, database, schema));
    return (
        <>
            <TreeToggle
                label={schema}
                level={level}
                expanded={expanded}
                onToggle={toggle}
                icon={
                    <FolderTreeIcon
                        aria-hidden
                        className="size-3.5 shrink-0 text-sidebar-foreground/60"
                    />
                }
            />
            {expanded && (
                <ObjectList
                    session={session}
                    database={database}
                    schema={schema}
                    level={level + 1}
                />
            )}
        </>
    );
}

function ObjectList({
    session,
    database,
    schema,
    level,
}: {
    session: SessionInfo;
    database: string;
    schema: string | null;
    level: number;
}) {
    const t = useT();
    const filter = useUiStore((ui) => ui.treeFilter.trim().toLowerCase());
    const objects = useQuery({
        queryKey: ["objects", session.sessionId, database, schema],
        queryFn: () => listObjects(session.sessionId, database, schema),
        staleTime: 60_000,
    });
    if (objects.isPending) {
        return <TreeMessage level={level - 1}>{t.schema.loadingTables}</TreeMessage>;
    }
    if (objects.isError) {
        return (
            <TreeMessage level={level - 1} error>
                {errorMessage(objects.error)}
            </TreeMessage>
        );
    }
    const visible = filter
        ? objects.data.filter((object) => object.name.toLowerCase().includes(filter))
        : objects.data;
    if (visible.length === 0) {
        return (
            <TreeMessage level={level - 1}>
                {filter ? t.schema.noMatches : t.schema.noTables}
            </TreeMessage>
        );
    }
    return (
        <ul role="group">
            {visible.map((object) => (
                <li key={object.name}>
                    <ObjectNode
                        session={session}
                        target={{ database, schema, table: object.name }}
                        object={object}
                        level={level}
                    />
                </li>
            ))}
        </ul>
    );
}

function ObjectNode({
    session,
    target,
    object,
    level,
}: {
    session: SessionInfo;
    target: TableTarget;
    object: DbObject;
    level: number;
}) {
    const t = useT();
    const open = () => useWorkspace.getState().openTableTab(session.sessionId, target);
    const qualified =
        session.engine === "postgres"
            ? `"${target.schema ?? "public"}"."${object.name}"`
            : `\`${object.name}\``;
    const Icon = object.kind === "view" ? EyeIcon : Table2Icon;

    return (
        <ContextMenu>
            <ContextMenuTrigger asChild>
                <button
                    type="button"
                    onClick={open}
                    className={ROW}
                    style={indent(level)}
                    title={object.name}
                >
                    <span aria-hidden className="w-3.5 shrink-0" />
                    <Icon aria-hidden className="size-3.5 shrink-0 text-sidebar-foreground/55" />
                    <span className="min-w-0 flex-1 truncate">{object.name}</span>
                </button>
            </ContextMenuTrigger>
            <ContextMenuContent className="w-56">
                <ContextMenuItem onSelect={open}>{t.schema.showData}</ContextMenuItem>
                <ContextMenuItem
                    onSelect={() =>
                        useWorkspace
                            .getState()
                            .openQueryTab(
                                session.sessionId,
                                target.database,
                                `SELECT *\nFROM ${qualified}\nLIMIT 100;`,
                            )
                    }
                >
                    {t.schema.selectInNewQuery}
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem onSelect={() => void copyText(object.name, t.schema.name)}>
                    {t.schema.copyName}
                </ContextMenuItem>
                <ContextMenuItem
                    onSelect={() =>
                        void tableDdl(session.sessionId, target)
                            .then((ddl) => copyText(ddl, t.schema.ddl))
                            .catch((error: unknown) =>
                                toast.error(t.schema.ddlFailed, {
                                    description: errorMessage(error),
                                }),
                            )
                    }
                >
                    {t.schema.copyDdl}
                </ContextMenuItem>
            </ContextMenuContent>
        </ContextMenu>
    );
}
