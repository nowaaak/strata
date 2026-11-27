import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CopyIcon, PencilIcon, RefreshCwIcon, SearchIcon } from "lucide-react";
import { useDeferredValue, useId, useState } from "react";
import { toast } from "sonner";
import { errorMessage } from "@/api/invoke";
import { previewServerVariable, serverInfo, setServerVariable } from "@/api/server";
import { useUiStore } from "@/app/uiStore";
import type { ServerInfoKind } from "@/bindings/ServerInfoKind";
import type { SessionInfo } from "@/bindings/SessionInfo";
import type { VariableChange } from "@/bindings/VariableChange";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useProfile } from "@/features/connections/useProfiles";
import { formatDuration } from "@/features/processes/duration";
import { useWorkspace } from "@/features/workspace/workspaceStore";
import { getT, useT } from "@/i18n";
import { cn } from "@/lib/utils";
import { durationSeconds, filterSettings } from "./filter";

const REFRESH_MS = 5000;

export function ServerInfoDialog() {
    const sessionId = useUiStore((ui) => ui.serverInfoSession);
    const session = useWorkspace((state) => (sessionId ? state.sessions[sessionId] : undefined));
    const close = () => useUiStore.getState().setServerInfoSession(null);

    return (
        <Dialog open={session !== undefined} onOpenChange={(open) => !open && close()}>
            <DialogContent className="flex h-[min(720px,calc(100vh-4rem))] flex-col sm:max-w-4xl">
                {session && <ServerInfo key={session.sessionId} session={session} />}
            </DialogContent>
        </Dialog>
    );
}

type Pending = { change: VariableChange; statements: string[]; restart: boolean } | null;

function ServerInfo({ session }: { session: SessionInfo }) {
    const t = useT();
    const text = t.server;
    const id = useId();
    const sessionId = session.sessionId;
    const profile = useProfile(session.profileId);
    const queryClient = useQueryClient();
    const [editing, setEditing] = useState<string | null>(null);
    const [draft, setDraft] = useState("");
    const [persist, setPersist] = useState(false);
    const [pending, setPending] = useState<Pending>(null);
    const canPersist = session.engine === "mysql" && session.server.flavor !== "MariaDB";
    const [kind, setKind] = useState<ServerInfoKind>("variables");
    const [search, setSearch] = useState("");
    const [onlyChanged, setOnlyChanged] = useState(false);
    const [autoRefresh, setAutoRefresh] = useState(false);
    const deferredSearch = useDeferredValue(search);

    const info = useQuery({
        queryKey: ["server-info", sessionId, kind],
        queryFn: () => serverInfo(sessionId, kind),
        refetchInterval: kind === "status" && autoRefresh ? REFRESH_MS : false,
        staleTime: kind === "variables" ? 60_000 : 0,
        retry: false,
    });

    const all = info.data ?? [];
    const canFilterChanged = kind === "variables" && all.some((setting) => setting.changed);
    const shown = filterSettings(all, deferredSearch, canFilterChanged && onlyChanged);

    const canEdit = kind === "variables" && !session.readOnly && session.engine !== "sqlite";

    const startEdit = (name: string, value: string) => {
        setEditing(name);
        setDraft(value);
        setPersist(false);
    };

    const propose = (name: string, value: string | null, restart: boolean) => {
        const change: VariableChange = { name, value, persist: canPersist && persist };
        previewServerVariable(sessionId, change)
            .then((statements) => setPending({ change, statements, restart }))
            .catch((error: unknown) =>
                toast.error(getT().server.failed, { description: errorMessage(error) }),
            );
    };

    const apply = useMutation({
        mutationFn: (change: VariableChange) => setServerVariable(sessionId, change),
        onSuccess: async () => {
            const restart = pending?.restart ?? false;
            toast.success(restart ? getT().server.savedRestart : getT().server.saved);
            setPending(null);
            setEditing(null);
            await queryClient.invalidateQueries({ queryKey: ["server-info", sessionId] });
        },
        onError: (error) => toast.error(getT().server.failed, { description: errorMessage(error) }),
    });

    const copy = async (name: string, value: string) => {
        try {
            await navigator.clipboard.writeText(value);
            toast.success(getT().server.copied(name));
        } catch (error) {
            toast.error(errorMessage(error));
        }
    };

    return (
        <>
            <DialogHeader>
                <DialogTitle>{text.title(profile?.name ?? "")}</DialogTitle>
                <DialogDescription>{text.description}</DialogDescription>
            </DialogHeader>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <Tabs value={kind} onValueChange={(value) => setKind(value as ServerInfoKind)}>
                    <TabsList>
                        <TabsTrigger value="variables">{text.variables}</TabsTrigger>
                        <TabsTrigger value="status">{text.status}</TabsTrigger>
                    </TabsList>
                </Tabs>
                <div className="relative min-w-56 flex-1">
                    <SearchIcon
                        className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
                        aria-hidden
                    />
                    <Input
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                        placeholder={text.search}
                        aria-label={text.search}
                        className="h-8 pl-8"
                        autoFocus
                    />
                </div>
                {canFilterChanged && (
                    <div className="flex items-center gap-2" title={text.onlyChangedHint}>
                        <Switch
                            id={`${id}-changed`}
                            checked={onlyChanged}
                            onCheckedChange={setOnlyChanged}
                        />
                        <Label htmlFor={`${id}-changed`} className="font-normal">
                            {text.onlyChanged}
                        </Label>
                    </div>
                )}
                {kind === "status" && (
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
                )}
                <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void info.refetch()}
                    disabled={info.isFetching}
                >
                    <RefreshCwIcon
                        className={cn(info.isFetching && "animate-spin motion-reduce:animate-none")}
                    />
                    {text.refresh}
                </Button>
            </div>

            {info.isError && (
                <p className="rounded-md border border-destructive/40 px-3 py-2 text-sm text-destructive select-text">
                    {text.loadFailed}: {errorMessage(info.error)}
                </p>
            )}

            <div className="min-h-0 flex-1 overflow-auto rounded-lg border">
                <table className="w-full border-collapse text-left text-[13px]">
                    <thead className="sticky top-0 z-10 bg-muted text-xs text-muted-foreground">
                        <tr>
                            <th className="w-2/5 px-3 py-2 font-medium">{text.columns.name}</th>
                            <th className="px-3 py-2 font-medium">{text.columns.value}</th>
                            <th className="w-10 px-2 py-2">
                                <span className="sr-only">{text.columns.actions}</span>
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        {shown.map((setting) => {
                            const seconds = durationSeconds(setting.name, setting.value);
                            return (
                                <tr key={setting.name} className="group border-t align-top">
                                    <td className="px-3 py-1.5">
                                        <div className="flex items-center gap-1.5">
                                            <span className="font-mono text-xs break-all select-text">
                                                {setting.name}
                                            </span>
                                            {setting.changed && (
                                                <span className="rounded bg-primary/15 px-1 py-0.5 text-[0.6875rem] font-medium text-primary">
                                                    {text.changed}
                                                </span>
                                            )}
                                            {setting.restart && (
                                                <span
                                                    title={text.restartHint}
                                                    className="rounded bg-amber-500/15 px-1 py-0.5 text-[0.6875rem] font-medium text-amber-700 dark:text-amber-300"
                                                >
                                                    {text.restart}
                                                </span>
                                            )}
                                        </div>
                                        {setting.category && (
                                            <div className="text-[0.6875rem] text-muted-foreground">
                                                {setting.category}
                                            </div>
                                        )}
                                    </td>
                                    <td className="px-3 py-1.5">
                                        {editing === setting.name ? (
                                            <form
                                                className="flex flex-wrap items-center gap-2"
                                                onSubmit={(event) => {
                                                    event.preventDefault();
                                                    propose(setting.name, draft, setting.restart);
                                                }}
                                            >
                                                <Input
                                                    autoFocus
                                                    aria-label={text.edit(setting.name)}
                                                    value={draft}
                                                    onChange={(event) =>
                                                        setDraft(event.target.value)
                                                    }
                                                    className="h-7 min-w-40 flex-1 font-mono text-xs"
                                                />
                                                <Button type="submit" size="sm" className="h-7">
                                                    {text.apply}
                                                </Button>
                                                <Button
                                                    type="button"
                                                    size="sm"
                                                    variant="outline"
                                                    className="h-7"
                                                    onClick={() =>
                                                        propose(setting.name, null, setting.restart)
                                                    }
                                                >
                                                    {text.reset}
                                                </Button>
                                                <Button
                                                    type="button"
                                                    size="sm"
                                                    variant="ghost"
                                                    className="h-7"
                                                    onClick={() => setEditing(null)}
                                                >
                                                    {t.common.cancel}
                                                </Button>
                                                {canPersist && (
                                                    <label className="flex w-full items-center gap-2 text-xs">
                                                        <input
                                                            type="checkbox"
                                                            className="size-4 accent-[var(--primary)]"
                                                            checked={persist}
                                                            onChange={(event) =>
                                                                setPersist(event.target.checked)
                                                            }
                                                        />
                                                        {text.persist}
                                                    </label>
                                                )}
                                            </form>
                                        ) : (
                                            <div className="font-mono text-xs break-all whitespace-pre-wrap tabular-nums select-text">
                                                {setting.value}
                                                {seconds !== null && (
                                                    <span className="ml-2 font-sans text-muted-foreground">
                                                        ({formatDuration(seconds)})
                                                    </span>
                                                )}
                                            </div>
                                        )}
                                        {setting.description && (
                                            <div className="mt-0.5 text-xs text-muted-foreground">
                                                {setting.description}
                                            </div>
                                        )}
                                    </td>
                                    <td className="px-2 py-1 text-right whitespace-nowrap">
                                        {canEdit &&
                                            setting.editable &&
                                            editing !== setting.name && (
                                                <Button
                                                    size="icon"
                                                    variant="ghost"
                                                    className="size-7 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                                                    aria-label={text.edit(setting.name)}
                                                    title={text.edit(setting.name)}
                                                    onClick={() =>
                                                        startEdit(setting.name, setting.value)
                                                    }
                                                >
                                                    <PencilIcon />
                                                </Button>
                                            )}
                                        <Button
                                            size="icon"
                                            variant="ghost"
                                            className="size-7 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                                            aria-label={text.copy(setting.name)}
                                            onClick={() => void copy(setting.name, setting.value)}
                                        >
                                            <CopyIcon />
                                        </Button>
                                    </td>
                                </tr>
                            );
                        })}
                        {shown.length === 0 && !info.isPending && (
                            <tr>
                                <td
                                    colSpan={3}
                                    className="px-3 py-6 text-center text-sm text-muted-foreground"
                                >
                                    {text.empty}
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
            <AlertDialog
                open={pending !== null}
                onOpenChange={(open) => !open && !apply.isPending && setPending(null)}
            >
                <AlertDialogContent className="sm:max-w-xl">
                    {pending && (
                        <>
                            <AlertDialogHeader>
                                <AlertDialogTitle>{text.confirmTitle}</AlertDialogTitle>
                                <AlertDialogDescription asChild>
                                    <div className="flex flex-col gap-2">
                                        <pre className="max-h-64 overflow-auto rounded-md bg-muted p-3 font-mono text-xs whitespace-pre-wrap text-foreground select-text">
                                            {pending.statements.join(";\n")};
                                        </pre>
                                        <span>
                                            {session.engine === "postgres"
                                                ? text.confirmPostgres
                                                : pending.change.persist
                                                  ? text.confirmPersist
                                                  : text.confirmGlobal}
                                        </span>
                                    </div>
                                </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                                <AlertDialogCancel disabled={apply.isPending}>
                                    {t.common.cancel}
                                </AlertDialogCancel>
                                <AlertDialogAction
                                    disabled={apply.isPending}
                                    onClick={(event) => {
                                        event.preventDefault();
                                        apply.mutate(pending.change);
                                    }}
                                >
                                    {text.run}
                                </AlertDialogAction>
                            </AlertDialogFooter>
                        </>
                    )}
                </AlertDialogContent>
            </AlertDialog>
            <span className="text-xs text-muted-foreground tabular-nums">
                {text.count(shown.length, all.length)}
            </span>
        </>
    );
}
