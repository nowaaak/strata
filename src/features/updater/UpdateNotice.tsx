import { useQuery } from "@tanstack/react-query";
import { ArrowUpCircleIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { errorMessage } from "@/api/invoke";
import { checkForUpdate, installUpdate, onUpdateProgress } from "@/api/updater";
import type { UpdateProgress } from "@/bindings/UpdateProgress";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { useRuns } from "@/features/result-grid/runStore";
import { getT, useT } from "@/i18n";

export const updateKey = ["app-update"] as const;
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

function megabytes(bytes: number) {
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function UpdateNotice() {
    const t = useT();
    const update = useQuery({
        queryKey: updateKey,
        queryFn: checkForUpdate,
        staleTime: Infinity,
        retry: false,
        refetchInterval: CHECK_INTERVAL_MS,
        refetchIntervalInBackground: true,
    });
    const [open, setOpen] = useState(false);

    if (!update.data) {
        return null;
    }

    return (
        <>
            <button
                type="button"
                onClick={() => setOpen(true)}
                className="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/10 p-2.5 text-left text-xs outline-none hover:bg-primary/15 focus-visible:ring-2 focus-visible:ring-ring"
            >
                <ArrowUpCircleIcon className="size-4 shrink-0 text-primary" aria-hidden />
                <span>
                    <span className="block font-medium">{t.updater.available}</span>
                    <span className="text-muted-foreground">
                        {t.updater.version(update.data.version)}
                    </span>
                </span>
            </button>
            {open && (
                <UpdateDialog
                    version={update.data.version}
                    currentVersion={update.data.currentVersion}
                    notes={update.data.notes}
                    onClose={() => setOpen(false)}
                />
            )}
        </>
    );
}

type UpdateDialogProps = {
    version: string;
    currentVersion: string;
    notes: string | null;
    onClose: () => void;
};

export function UpdateDialog({ version, currentVersion, notes, onClose }: UpdateDialogProps) {
    const t = useT();
    const queriesRunning = useRuns((state) => Object.values(state.runs).some((run) => run.running));
    const [installing, setInstalling] = useState(false);
    const [progress, setProgress] = useState<UpdateProgress | null>(null);

    useEffect(() => {
        let unlisten: (() => void) | undefined;
        let disposed = false;
        void onUpdateProgress(setProgress).then((fn) => {
            if (disposed) {
                fn();
            } else {
                unlisten = fn;
            }
        });
        return () => {
            disposed = true;
            unlisten?.();
        };
    }, []);

    const install = async () => {
        setInstalling(true);
        try {
            await installUpdate();
        } catch (error) {
            setInstalling(false);
            toast.error(getT().updater.failed, { description: errorMessage(error) });
        }
    };

    const value =
        progress?.total && progress.total > 0
            ? Math.min(100, Math.round((progress.downloaded / progress.total) * 100))
            : null;

    return (
        <Dialog open onOpenChange={(next) => !next && !installing && onClose()}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{t.updater.dialogTitle(version)}</DialogTitle>
                    <DialogDescription>
                        {t.updater.dialogDescription(currentVersion)}
                    </DialogDescription>
                </DialogHeader>
                {notes && (
                    <div className="max-h-60 overflow-auto rounded-md border bg-muted/40 p-3 text-sm whitespace-pre-wrap select-text">
                        {notes}
                    </div>
                )}
                <p className="text-sm text-muted-foreground">{t.updater.unsavedEdits}</p>
                {queriesRunning && (
                    <p className="text-sm text-amber-600 dark:text-amber-400">
                        {t.updater.queriesRunning}
                    </p>
                )}
                {installing && (
                    <div className="flex flex-col gap-1" role="status">
                        <Progress value={value ?? 0} aria-label={t.updater.progressLabel} />
                        <p className="text-xs text-muted-foreground tabular-nums">
                            {progress
                                ? `${megabytes(progress.downloaded)}${progress.total ? ` / ${megabytes(progress.total)}` : ""}`
                                : t.updater.downloadStarting}
                        </p>
                    </div>
                )}
                <DialogFooter>
                    <Button variant="ghost" disabled={installing} onClick={onClose}>
                        {t.updater.later}
                    </Button>
                    <Button disabled={installing || queriesRunning} onClick={() => void install()}>
                        {installing ? t.updater.installing : t.updater.installNow}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
