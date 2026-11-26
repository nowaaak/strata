import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCwIcon, ShieldAlertIcon, SquareIcon, UnplugIcon } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { errorMessage } from "@/api/invoke";
import { killProcess, listProcesses } from "@/api/processes";
import { useUiStore } from "@/app/uiStore";
import type { KillMode } from "@/bindings/KillMode";
import type { ProcessInfo } from "@/bindings/ProcessInfo";
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
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useProfile } from "@/features/connections/useProfiles";
import { useWorkspace } from "@/features/workspace/workspaceStore";
import { getT, useT } from "@/i18n";
import { cn } from "@/lib/utils";
import { formatDuration } from "./duration";

const REFRESH_MS = 2000;

type PendingKill = { process: ProcessInfo; mode: KillMode } | null;

export function ProcessDialog() {
    const sessionId = useUiStore((ui) => ui.processListSession);
    const session = useWorkspace((state) => (sessionId ? state.sessions[sessionId] : undefined));
    const close = () => useUiStore.getState().setProcessListSession(null);

    return (
        <Dialog open={session !== undefined} onOpenChange={(open) => !open && close()}>
            <DialogContent className="flex max-h-[calc(100vh-4rem)] flex-col sm:max-w-5xl">
                {session && (
                    <ProcessList
                        key={session.sessionId}
                        sessionId={session.sessionId}
                        profileId={session.profileId}
                        readOnly={session.readOnly}
                    />
                )}
            </DialogContent>
        </Dialog>
    );
}

function ProcessList({
    sessionId,
    profileId,
    readOnly,
}: {
    sessionId: string;
    profileId: string;
    readOnly: boolean;
}) {
    const t = useT();
    const text = t.processes;
    const id = useId();
    const queryClient = useQueryClient();
    const profile = useProfile(profileId);
    const [onlyActive, setOnlyActive] = useState(true);
    const [autoRefresh, setAutoRefresh] = useState(true);
    const [pending, setPending] = useState<PendingKill>(null);
    const queryKey = ["processes", sessionId];

    const processes = useQuery({
        queryKey,
        queryFn: () => listProcesses(sessionId),
        refetchInterval: autoRefresh ? REFRESH_MS : false,
        retry: false,
    });

    const kill = useMutation({
        mutationFn: ({ process, mode }: { process: ProcessInfo; mode: KillMode }) =>
            killProcess(sessionId, process.id, mode),
        onSuccess: async (_, { process }) => {
            toast.success(getT().processes.done(process.id));
            await queryClient.invalidateQueries({ queryKey });
        },
        onError: (error) =>
            toast.error(getT().processes.failed, { description: errorMessage(error) }),
    });

    const all = processes.data ?? [];
    const shown = onlyActive ? all.filter((process) => process.active || process.own) : all;

    return (
        <>
            <DialogHeader>
                <DialogTitle>{text.title(profile?.name ?? "")}</DialogTitle>
                <DialogDescription>{text.description}</DialogDescription>
            </DialogHeader>

            <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                <div className="flex items-center gap-2">
                    <Switch
                        id={`${id}-active`}
                        checked={onlyActive}
                        onCheckedChange={setOnlyActive}
                    />
                    <Label htmlFor={`${id}-active`} className="font-normal">
                        {text.onlyActive}
                    </Label>
                </div>
                <div className="flex items-center gap-2">
                    <Switch
                        id={`${id}-refresh`}
                        checked={autoRefresh}
                        onCheckedChange={setAutoRefresh}
                    />
                    <Label htmlFor={`${id}-refresh`} className="font-normal">
                        {text.autoRefresh}
                    </Label>
                </div>
                <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void processes.refetch()}
                    disabled={processes.isFetching}
                >
                    <RefreshCwIcon
                        className={cn(
                            processes.isFetching && "animate-spin motion-reduce:animate-none",
                        )}
                    />
                    {text.refresh}
                </Button>
                <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                    {text.count(shown.length, all.length)}
                </span>
            </div>

            {readOnly && (
                <p className="flex items-center gap-2 rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                    <ShieldAlertIcon className="size-3.5 shrink-0" aria-hidden />
                    {text.readOnly}
                </p>
            )}

            {processes.isError && (
                <p className="rounded-md border border-destructive/40 px-3 py-2 text-sm text-destructive select-text">
                    {text.loadFailed}: {errorMessage(processes.error)}
                </p>
            )}

            <div className="min-h-0 flex-1 overflow-auto rounded-lg border">
                <table className="w-full border-collapse text-left text-[13px]">
                    <thead className="sticky top-0 z-10 bg-muted text-xs text-muted-foreground">
                        <tr>
                            <th className="px-3 py-2 font-medium">{text.columns.id}</th>
                            <th className="px-3 py-2 font-medium">{text.columns.user}</th>
                            <th className="px-3 py-2 font-medium">{text.columns.client}</th>
                            <th className="px-3 py-2 font-medium">{text.columns.database}</th>
                            <th className="px-3 py-2 font-medium">{text.columns.state}</th>
                            <th className="px-3 py-2 text-right font-medium">
                                {text.columns.time}
                            </th>
                            <th className="px-3 py-2 font-medium">{text.columns.query}</th>
                            {!readOnly && (
                                <th className="px-3 py-2 text-right font-medium">
                                    <span className="sr-only">{text.columns.actions}</span>
                                </th>
                            )}
                        </tr>
                    </thead>
                    <tbody>
                        {shown.map((process) => (
                            <tr
                                key={process.id}
                                className={cn(
                                    "border-t align-top",
                                    !process.active && "text-muted-foreground",
                                )}
                            >
                                <td className="px-3 py-1.5 font-mono tabular-nums">
                                    {process.id}
                                    {process.own && (
                                        <Tooltip>
                                            <TooltipTrigger asChild>
                                                <span className="ml-1.5 rounded bg-primary/15 px-1 py-0.5 font-sans text-[0.6875rem] font-medium text-primary">
                                                    {text.own}
                                                </span>
                                            </TooltipTrigger>
                                            <TooltipContent>{text.ownHint}</TooltipContent>
                                        </Tooltip>
                                    )}
                                </td>
                                <td className="px-3 py-1.5">{process.user}</td>
                                <td className="px-3 py-1.5 font-mono text-xs">{process.client}</td>
                                <td className="px-3 py-1.5">{process.database}</td>
                                <td className="px-3 py-1.5 whitespace-nowrap">{process.state}</td>
                                <td className="px-3 py-1.5 text-right whitespace-nowrap tabular-nums">
                                    {formatDuration(process.seconds)}
                                </td>
                                <td className="max-w-md px-3 py-1.5">
                                    <code
                                        title={process.query ?? undefined}
                                        className="line-clamp-2 font-mono text-xs break-all select-text"
                                    >
                                        {process.query}
                                    </code>
                                </td>
                                {!readOnly && (
                                    <td className="px-2 py-1 text-right whitespace-nowrap">
                                        <KillButton
                                            label={text.cancelQuery}
                                            disabled={process.own || !process.active}
                                            onClick={() => setPending({ process, mode: "query" })}
                                        >
                                            <SquareIcon />
                                        </KillButton>
                                        <KillButton
                                            label={text.killConnection}
                                            disabled={process.own}
                                            onClick={() =>
                                                setPending({ process, mode: "connection" })
                                            }
                                        >
                                            <UnplugIcon />
                                        </KillButton>
                                    </td>
                                )}
                            </tr>
                        ))}
                        {shown.length === 0 && !processes.isPending && (
                            <tr>
                                <td
                                    colSpan={readOnly ? 7 : 8}
                                    className="px-3 py-6 text-center text-sm text-muted-foreground"
                                >
                                    {text.empty}
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>

            <AlertDialog open={pending !== null} onOpenChange={(open) => !open && setPending(null)}>
                <AlertDialogContent className="sm:max-w-lg">
                    {pending && (
                        <>
                            <AlertDialogHeader>
                                <AlertDialogTitle>
                                    {pending.mode === "query"
                                        ? text.confirm.query_title(pending.process.id)
                                        : text.confirm.connection_title(pending.process.id)}
                                </AlertDialogTitle>
                                <AlertDialogDescription>
                                    {pending.mode === "query"
                                        ? text.confirm.query_description
                                        : text.confirm.connection_description}
                                </AlertDialogDescription>
                            </AlertDialogHeader>
                            {pending.process.query && (
                                <pre className="max-h-40 overflow-auto rounded-md bg-muted p-3 font-mono text-xs whitespace-pre-wrap select-text">
                                    {pending.process.query}
                                </pre>
                            )}
                            <AlertDialogFooter>
                                <AlertDialogCancel>{t.common.cancel}</AlertDialogCancel>
                                <AlertDialogAction
                                    variant="destructive"
                                    onClick={() => {
                                        kill.mutate(pending);
                                        setPending(null);
                                    }}
                                >
                                    {pending.mode === "query"
                                        ? text.confirm.query_action
                                        : text.confirm.connection_action}
                                </AlertDialogAction>
                            </AlertDialogFooter>
                        </>
                    )}
                </AlertDialogContent>
            </AlertDialog>
        </>
    );
}

function KillButton({
    label,
    disabled,
    onClick,
    children,
}: {
    label: string;
    disabled: boolean;
    onClick: () => void;
    children: ReactNode;
}) {
    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <Button
                    size="icon"
                    variant="ghost"
                    className="size-7"
                    aria-label={label}
                    disabled={disabled}
                    onClick={onClick}
                >
                    {children}
                </Button>
            </TooltipTrigger>
            <TooltipContent>{label}</TooltipContent>
        </Tooltip>
    );
}
