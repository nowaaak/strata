import "@xyflow/react/dist/style.css";
import "./er.css";
import { useQuery } from "@tanstack/react-query";
import {
    Background,
    Controls,
    Handle,
    MarkerType,
    MiniMap,
    Position,
    ReactFlow,
    ReactFlowProvider,
    useReactFlow,
    type Edge,
    type Node,
    type NodeProps,
} from "@xyflow/react";
import { EyeIcon, KeyRoundIcon, LinkIcon, Loader2Icon, SearchIcon, Table2Icon } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { errorMessage } from "@/api/invoke";
import { schemaGraph } from "@/api/schema";
import { useUiStore, type ErRequest } from "@/app/uiStore";
import type { SchemaGraph } from "@/bindings/SchemaGraph";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useWorkspace } from "@/features/workspace/workspaceStore";
import { useT } from "@/i18n";
import { normalize } from "@/lib/fuzzy";
import { cn } from "@/lib/utils";
import { HEADER_HEIGHT, ROW_HEIGHT, layoutSchema, visibleColumns, type ErTable } from "./layout";

type TableData = { table: ErTable; compact: boolean; matched: boolean; dimmed: boolean };
type TableNode = Node<TableData, "table">;

export function ErDialog() {
    const request = useUiStore((ui) => ui.erRequest);
    const close = () => useUiStore.getState().setErRequest(null);
    return (
        <Dialog open={request !== null} onOpenChange={(open) => !open && close()}>
            <DialogContent className="flex h-[calc(100vh-3rem)] flex-col sm:max-w-[min(1600px,calc(100vw-3rem))]">
                {request && (
                    <ReactFlowProvider>
                        <ErBody key={JSON.stringify(request)} request={request} onDone={close} />
                    </ReactFlowProvider>
                )}
            </DialogContent>
        </Dialog>
    );
}

function ErBody({ request, onDone }: { request: NonNullable<ErRequest>; onDone: () => void }) {
    const t = useT();
    const text = t.er;
    const name = request.schema ? `${request.database}.${request.schema}` : request.database;
    const graph = useQuery({
        queryKey: ["schema-graph", request.sessionId, request.database, request.schema],
        queryFn: () => schemaGraph(request.sessionId, request.database, request.schema),
        staleTime: 0,
        gcTime: 0,
    });

    return (
        <>
            <DialogHeader>
                <DialogTitle>{text.title(name)}</DialogTitle>
                <DialogDescription>{text.description}</DialogDescription>
            </DialogHeader>
            {graph.isPending && (
                <p className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
                    <Loader2Icon className="size-4 animate-spin motion-reduce:animate-none" />
                    {text.loading}
                </p>
            )}
            {graph.isError && (
                <p className="py-10 text-sm text-destructive select-text">
                    {text.loadFailed}: {errorMessage(graph.error)}
                </p>
            )}
            {graph.data && graph.data.tables.length === 0 && (
                <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
                    {text.empty}
                </p>
            )}
            {graph.data && graph.data.tables.length > 0 && (
                <Diagram request={request} graph={graph.data} onDone={onDone} />
            )}
        </>
    );
}

function Diagram({
    request,
    graph,
    onDone,
}: {
    request: NonNullable<ErRequest>;
    graph: SchemaGraph;
    onDone: () => void;
}) {
    const t = useT();
    const text = t.er;
    const id = useId();
    const flow = useReactFlow();
    const [compact, setCompact] = useState(false);
    const [onlyRelated, setOnlyRelated] = useState(false);
    const [search, setSearch] = useState("");

    const layout = useMemo(
        () => layoutSchema(graph, { compact, onlyRelated }),
        [graph, compact, onlyRelated],
    );
    const term = normalize(search.trim());
    const matches = useMemo(
        () =>
            term === ""
                ? []
                : layout.tables
                      .filter((table) => normalize(table.name).includes(term))
                      .map((table) => table.name),
        [layout, term],
    );

    const nodes = useMemo<TableNode[]>(
        () =>
            layout.tables.map((table) => {
                const box = layout.boxes.get(table.name)!;
                return {
                    id: table.name,
                    type: "table",
                    position: { x: box.x, y: box.y },
                    width: box.width,
                    height: box.height,
                    data: {
                        table,
                        compact,
                        matched: matches.includes(table.name),
                        dimmed: matches.length > 0 && !matches.includes(table.name),
                    },
                };
            }),
        [layout, compact, matches],
    );
    const edges = useMemo<Edge[]>(
        () =>
            graph.foreignKeys
                .filter((key) => layout.boxes.has(key.table) && layout.boxes.has(key.targetTable))
                .map((key) => ({
                    id: `${key.table}.${key.name}`,
                    source: key.targetTable,
                    target: key.table,
                    type: "smoothstep",
                    label: key.columns.join(", "),
                    markerStart: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
                    className: "er-edge",
                })),
        [graph, layout],
    );

    const focus = (names: string[]) => {
        if (names.length > 0) {
            void flow.fitView({
                nodes: names.map((name) => ({ id: name })),
                duration: 300,
                maxZoom: 1.2,
            });
        }
    };

    const openTable = (table: string) => {
        useWorkspace.getState().openTableTab(request.sessionId, {
            database: request.database,
            schema: request.schema,
            table,
        });
        onDone();
    };

    return (
        <div className="flex min-h-0 flex-1 flex-col gap-3">
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                <div className="relative w-64">
                    <SearchIcon
                        className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
                        aria-hidden
                    />
                    <Input
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                        onKeyDown={(event) => event.key === "Enter" && focus(matches)}
                        placeholder={text.search}
                        aria-label={text.search}
                        className="h-8 pl-8"
                    />
                </div>
                <div className="flex items-center gap-2">
                    <Switch id={`${id}-compact`} checked={compact} onCheckedChange={setCompact} />
                    <Label htmlFor={`${id}-compact`} className="font-normal">
                        {text.compact}
                    </Label>
                </div>
                <div className="flex items-center gap-2">
                    <Switch
                        id={`${id}-related`}
                        checked={onlyRelated}
                        onCheckedChange={setOnlyRelated}
                    />
                    <Label htmlFor={`${id}-related`} className="font-normal">
                        {text.onlyRelated}
                    </Label>
                </div>
                <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                    {search.trim() !== "" && `${text.matches(matches.length)} · `}
                    {text.count(layout.tables.length, edges.length)}
                </span>
            </div>
            {graph.truncated && (
                <p className="rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                    {text.truncated(graph.tables.length)}
                </p>
            )}
            <div className="er-canvas min-h-0 flex-1 overflow-hidden rounded-lg border">
                <ReactFlow<TableNode, Edge>
                    nodes={nodes}
                    edges={edges}
                    nodeTypes={NODE_TYPES}
                    fitView
                    minZoom={0.05}
                    maxZoom={2}
                    nodesConnectable={false}
                    edgesFocusable={false}
                    onlyRenderVisibleElements
                    proOptions={{ hideAttribution: true }}
                    onNodeDoubleClick={(_, node) => openTable(node.id)}
                >
                    <Background gap={24} />
                    <Controls showInteractive={false} />
                    <MiniMap pannable zoomable />
                </ReactFlow>
            </div>
            <p className="text-xs text-muted-foreground">{text.hint}</p>
        </div>
    );
}

function TableCard({ data }: NodeProps<TableNode>) {
    const t = useT();
    const { table, compact, matched, dimmed } = data;
    const Icon = table.kind === "view" ? EyeIcon : Table2Icon;
    const columns = visibleColumns(table, compact);
    return (
        <div
            className={cn(
                "h-full overflow-hidden rounded-lg border bg-card text-card-foreground shadow-sm transition-opacity",
                matched && "ring-2 ring-primary",
                dimmed && "opacity-35",
            )}
        >
            <Handle type="target" position={Position.Left} className="er-handle" />
            <Handle type="source" position={Position.Right} className="er-handle" />
            <div
                className="flex items-center gap-1.5 border-b bg-muted px-2.5 text-[13px] font-medium"
                style={{ height: HEADER_HEIGHT }}
            >
                <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                <span className="truncate font-mono">{table.name}</span>
            </div>
            <ul className="py-1">
                {columns.map((column) => {
                    const foreign = table.foreignColumns.has(column.name);
                    return (
                        <li
                            key={column.name}
                            className="flex items-center gap-1.5 px-2.5 text-xs"
                            style={{ height: ROW_HEIGHT }}
                        >
                            <span className="flex w-3.5 shrink-0 justify-center">
                                {column.primary ? (
                                    <KeyRoundIcon
                                        className="size-3 text-amber-500"
                                        aria-label={t.er.primary}
                                    />
                                ) : foreign ? (
                                    <LinkIcon
                                        className="size-3 text-primary"
                                        aria-label={t.er.foreign}
                                    />
                                ) : null}
                            </span>
                            <span
                                className={cn(
                                    "truncate font-mono",
                                    column.primary && "font-semibold",
                                    !column.nullable && !column.primary && "font-medium",
                                )}
                            >
                                {column.name}
                            </span>
                            <span className="ml-auto truncate pl-2 font-mono text-[0.6875rem] text-muted-foreground">
                                {column.dataType}
                                {column.nullable ? "" : " *"}
                            </span>
                        </li>
                    );
                })}
                {compact && columns.length === 0 && (
                    <li
                        className="px-2.5 text-xs text-muted-foreground"
                        style={{ height: ROW_HEIGHT }}
                    >
                        {t.er.noKeys}
                    </li>
                )}
            </ul>
        </div>
    );
}

const NODE_TYPES = { table: TableCard };
