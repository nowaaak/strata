import { useQuery } from "@tanstack/react-query";
import { CopyIcon, RefreshCwIcon, SearchIcon } from "lucide-react";
import { useDeferredValue, useId, useState } from "react";
import { toast } from "sonner";
import { errorMessage } from "@/api/invoke";
import { serverInfo } from "@/api/server";
import { useUiStore } from "@/app/uiStore";
import type { ServerInfoKind } from "@/bindings/ServerInfoKind";
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
                {session && (
                    <ServerInfo
                        key={session.sessionId}
                        sessionId={session.sessionId}
                        profileId={session.profileId}
                    />
                )}
            </DialogContent>
        </Dialog>
    );
}

function ServerInfo({ sessionId, profileId }: { sessionId: string; profileId: string }) {
    const t = useT();
    const text = t.server;
    const id = useId();
    const profile = useProfile(profileId);
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
                                        </div>
                                        {setting.category && (
                                            <div className="text-[0.6875rem] text-muted-foreground">
                                                {setting.category}
                                            </div>
                                        )}
                                    </td>
                                    <td className="px-3 py-1.5">
                                        <div className="font-mono text-xs break-all whitespace-pre-wrap tabular-nums select-text">
                                            {setting.value}
                                            {seconds !== null && (
                                                <span className="ml-2 font-sans text-muted-foreground">
                                                    ({formatDuration(seconds)})
                                                </span>
                                            )}
                                        </div>
                                        {setting.description && (
                                            <div className="mt-0.5 text-xs text-muted-foreground">
                                                {setting.description}
                                            </div>
                                        )}
                                    </td>
                                    <td className="px-2 py-1 text-right">
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
            <span className="text-xs text-muted-foreground tabular-nums">
                {text.count(shown.length, all.length)}
            </span>
        </>
    );
}
