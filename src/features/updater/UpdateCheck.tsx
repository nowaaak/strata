import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2Icon } from "lucide-react";
import { useState } from "react";
import { errorMessage } from "@/api/invoke";
import { checkForUpdate, getAppInfo } from "@/api/updater";
import type { UpdateInfo } from "@/bindings/UpdateInfo";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n";
import { UpdateDialog, updateKey } from "./UpdateNotice";

export const appInfoKey = ["app-info"] as const;

export function useAppInfo() {
    return useQuery({ queryKey: appInfoKey, queryFn: getAppInfo, staleTime: Infinity });
}

type CheckState =
    | { status: "idle" }
    | { status: "checking" }
    | { status: "current" }
    | { status: "available"; update: UpdateInfo }
    | { status: "error"; message: string };

export function UpdateCheck() {
    const t = useT();
    const queryClient = useQueryClient();
    const info = useAppInfo();
    const [state, setState] = useState<CheckState>({ status: "idle" });
    const [dialogOpen, setDialogOpen] = useState(false);

    if (!info.data) {
        return null;
    }
    const dev = info.data.channel === "dev";

    const check = async () => {
        setState({ status: "checking" });
        try {
            const update = await checkForUpdate();
            queryClient.setQueryData(updateKey, update);
            setState(update ? { status: "available", update } : { status: "current" });
            setDialogOpen(update !== null);
        } catch (error) {
            setState({ status: "error", message: errorMessage(error) });
        }
    };

    return (
        <div className="flex flex-col gap-2">
            <div className="flex flex-col gap-1.5">
                <span className="text-sm leading-none font-medium">{t.updater.channel}</span>
                <span className="text-sm text-muted-foreground">
                    {dev ? t.updater.channelDev : t.updater.channelRelease}
                </span>
            </div>
            {!dev && (
                <div className="flex flex-wrap items-center gap-3">
                    <Button
                        variant="outline"
                        size="sm"
                        disabled={state.status === "checking"}
                        onClick={() => void check()}
                    >
                        {state.status === "checking" && (
                            <Loader2Icon className="animate-spin motion-reduce:animate-none" />
                        )}
                        {state.status === "checking" ? t.updater.checking : t.updater.check}
                    </Button>
                    <span aria-live="polite" className="text-sm text-muted-foreground">
                        {state.status === "current" && t.updater.upToDate}
                        {state.status === "available" && (
                            <button
                                type="button"
                                className="text-primary underline-offset-4 hover:underline"
                                onClick={() => setDialogOpen(true)}
                            >
                                {t.updater.available}: {t.updater.version(state.update.version)}
                            </button>
                        )}
                        {state.status === "error" && (
                            <span className="text-destructive select-text">
                                {t.updater.checkFailed}: {state.message}
                            </span>
                        )}
                    </span>
                </div>
            )}
            {state.status === "available" && dialogOpen && (
                <UpdateDialog
                    version={state.update.version}
                    currentVersion={state.update.currentVersion}
                    notes={state.update.notes}
                    onClose={() => setDialogOpen(false)}
                />
            )}
        </div>
    );
}
