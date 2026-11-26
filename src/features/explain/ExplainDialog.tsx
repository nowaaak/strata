import { useQuery } from "@tanstack/react-query";
import { AlertTriangleIcon, CopyIcon, Loader2Icon } from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";
import { errorMessage } from "@/api/invoke";
import { explainQuery } from "@/api/query";
import { useUiStore, type ExplainRequest } from "@/app/uiStore";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { getT, useT } from "@/i18n";
import { cn } from "@/lib/utils";
import { countWarnings, parsePlan, type PlanNode } from "./plan";

export function ExplainDialog() {
    const request = useUiStore((ui) => ui.explainRequest);
    const close = () => useUiStore.getState().setExplainRequest(null);
    return (
        <Dialog open={request !== null} onOpenChange={(open) => !open && close()}>
            <DialogContent className="flex max-h-[calc(100vh-3rem)] flex-col sm:max-w-4xl">
                {request && <ExplainBody key={JSON.stringify(request)} request={request} />}
            </DialogContent>
        </Dialog>
    );
}

function formatNumber(value: number): string {
    return value.toLocaleString(getT().common.locale, { maximumFractionDigits: 2 });
}

function ExplainBody({ request }: { request: NonNullable<ExplainRequest> }) {
    const t = useT();
    const text = t.explain;
    const id = useId();
    const [analyze, setAnalyze] = useState(false);
    const [raw, setRaw] = useState(false);
    const canAnalyze = request.engine === "postgres" && !request.writes;

    const plan = useQuery({
        queryKey: ["explain", request.sessionId, request.database, request.sql, analyze],
        queryFn: async () => {
            const json = await explainQuery(
                request.sessionId,
                request.database,
                request.sql,
                analyze,
            );
            return { json, plan: parsePlan(request.engine, json) };
        },
        retry: false,
        gcTime: 0,
    });

    const copy = async () => {
        if (!plan.data) {
            return;
        }
        try {
            await navigator.clipboard.writeText(plan.data.json);
            toast.success(getT().common.copied("JSON"));
        } catch (error) {
            toast.error(getT().common.copyFailed, { description: errorMessage(error) });
        }
    };

    const warnings = plan.data ? countWarnings(plan.data.plan.root) : 0;

    return (
        <>
            <DialogHeader>
                <DialogTitle>{text.title}</DialogTitle>
                <DialogDescription>{text.description}</DialogDescription>
            </DialogHeader>
            <pre className="max-h-20 shrink-0 overflow-auto rounded-md bg-muted px-3 py-2 font-mono text-xs whitespace-pre-wrap select-text">
                {request.sql}
            </pre>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                {canAnalyze && (
                    <div className="flex items-center gap-2" title={text.analyzeHint}>
                        <Switch
                            id={`${id}-analyze`}
                            checked={analyze}
                            onCheckedChange={setAnalyze}
                        />
                        <Label htmlFor={`${id}-analyze`} className="font-normal">
                            {text.analyze}
                        </Label>
                    </div>
                )}
                {plan.data && (
                    <span
                        className={cn(
                            "flex items-center gap-1.5 text-xs",
                            warnings > 0
                                ? "text-amber-600 dark:text-amber-400"
                                : "text-muted-foreground",
                        )}
                    >
                        {warnings > 0 && <AlertTriangleIcon className="size-3.5" aria-hidden />}
                        {text.warnings(warnings)}
                    </span>
                )}
                <span className="ml-auto flex items-center gap-1.5">
                    {plan.data?.plan.planningMs != null && (
                        <span className="text-xs text-muted-foreground tabular-nums">
                            {text.planning(formatNumber(plan.data.plan.planningMs))}
                        </span>
                    )}
                    {plan.data?.plan.executionMs != null && (
                        <span className="text-xs text-muted-foreground tabular-nums">
                            {text.execution(formatNumber(plan.data.plan.executionMs))}
                        </span>
                    )}
                    <Button
                        variant="ghost"
                        size="xs"
                        disabled={!plan.data}
                        onClick={() => setRaw(!raw)}
                    >
                        {raw ? text.hideJson : text.showJson}
                    </Button>
                    <Button
                        variant="ghost"
                        size="xs"
                        disabled={!plan.data}
                        onClick={() => void copy()}
                    >
                        <CopyIcon />
                        {text.copyJson}
                    </Button>
                </span>
            </div>
            <div className="min-h-40 flex-1 overflow-auto rounded-lg border p-2">
                {plan.isPending && (
                    <p className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
                        <Loader2Icon className="size-4 animate-spin motion-reduce:animate-none" />
                        {text.loading}
                    </p>
                )}
                {plan.isError && (
                    <p className="p-4 text-sm text-destructive select-text">
                        {text.failed}: {errorMessage(plan.error)}
                    </p>
                )}
                {plan.data &&
                    (raw ? (
                        <pre className="p-2 font-mono text-xs whitespace-pre-wrap select-text">
                            {JSON.stringify(JSON.parse(plan.data.json), null, 2)}
                        </pre>
                    ) : (
                        <ul role="tree" aria-label={text.title}>
                            <PlanItem
                                node={plan.data.plan.root}
                                engine={request.engine}
                                depth={0}
                            />
                        </ul>
                    ))}
            </div>
        </>
    );
}

function PlanItem({
    node,
    engine,
    depth,
}: {
    node: PlanNode;
    engine: "mysql" | "postgres";
    depth: number;
}) {
    const t = useT();
    const text = t.explain;
    const accessLabel = engine === "mysql" ? text.access[node.title] : undefined;

    return (
        <li role="treeitem" aria-expanded aria-selected={false}>
            <div
                className={cn(
                    "flex flex-col gap-0.5 rounded-md py-1.5 pr-2",
                    node.warnings.length > 0 && "bg-amber-500/5",
                )}
                style={{ paddingLeft: `${depth * 18 + 8}px` }}
            >
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <span className="text-[13px] font-medium">
                        {accessLabel ? `${accessLabel} (${node.title})` : node.title}
                    </span>
                    {node.target && (
                        <span className="font-mono text-xs text-primary">{node.target}</span>
                    )}
                    <span className="ml-auto flex gap-3 text-[11px] text-muted-foreground tabular-nums">
                        {node.rows !== null && (
                            <span>
                                {formatNumber(node.rows)} {text.rows}
                            </span>
                        )}
                        {node.actualRows !== null && (
                            <span className="text-foreground/80">
                                {formatNumber(node.actualRows)} {text.actualRows}
                            </span>
                        )}
                        {node.actualMs !== null && <span>{formatNumber(node.actualMs)} ms</span>}
                        {node.cost !== null && (
                            <span>
                                {text.cost} {formatNumber(node.cost)}
                            </span>
                        )}
                    </span>
                </div>
                {node.details.map((entry) => (
                    <span
                        key={entry.label}
                        className="font-mono text-[11px] break-all text-muted-foreground select-text"
                    >
                        {entry.label}: {entry.value}
                    </span>
                ))}
                {node.warnings.map((warning) => (
                    <span
                        key={warning}
                        className="flex items-center gap-1.5 text-[11px] text-amber-600 dark:text-amber-400"
                    >
                        <AlertTriangleIcon className="size-3" aria-hidden />
                        {text.warning[warning]}
                    </span>
                ))}
            </div>
            {node.children.length > 0 && (
                <ul
                    role="group"
                    className="border-l border-border/60"
                    style={{ marginLeft: `${depth * 18 + 14}px` }}
                >
                    {node.children.map((child, index) => (
                        <PlanItem key={index} node={child} engine={engine} depth={0} />
                    ))}
                </ul>
            )}
        </li>
    );
}
