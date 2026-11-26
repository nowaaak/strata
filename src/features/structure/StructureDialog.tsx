import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2Icon } from "lucide-react";
import { useId, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { previewDdl, runDdl } from "@/api/ddl";
import { errorMessage } from "@/api/invoke";
import { useUiStore } from "@/app/uiStore";
import type { DdlAction } from "@/bindings/DdlAction";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { getT, useT } from "@/i18n";
import {
    descriptionOf,
    editableValue,
    isUnchangedRename,
    needsTypedConfirmation,
    subjectOf,
    titleOf,
    verbOf,
    withValue,
} from "./actions";
import { applyStructureChange } from "./effects";

export function StructureDialog() {
    const request = useUiStore((ui) => ui.structureRequest);
    const close = () => useUiStore.getState().setStructureRequest(null);

    return (
        <Dialog open={request !== null} onOpenChange={(open) => !open && close()}>
            <DialogContent className="sm:max-w-lg">
                {request && (
                    <StructureForm
                        key={JSON.stringify(request)}
                        sessionId={request.sessionId}
                        initial={request.action}
                        onDone={close}
                    />
                )}
            </DialogContent>
        </Dialog>
    );
}

function StructureForm({
    sessionId,
    initial,
    onDone,
}: {
    sessionId: string;
    initial: DdlAction;
    onDone: () => void;
}) {
    const t = useT();
    const text = t.structure;
    const id = useId();
    const queryClient = useQueryClient();
    const [action, setAction] = useState(initial);
    const [confirmation, setConfirmation] = useState("");
    const verb = verbOf(action);
    const value = editableValue(action);
    const subject = subjectOf(initial);

    const preview = useQuery({
        queryKey: ["ddl-preview", sessionId, action],
        queryFn: () => previewDdl(sessionId, action),
        retry: false,
        placeholderData: (previous) => previous,
    });

    const run = useMutation({
        mutationFn: () => runDdl(sessionId, action),
        onSuccess: async () => {
            onDone();
            toast.success(getT().structure.done, { description: preview.data });
            await applyStructureChange(queryClient, sessionId, action);
        },
        onError: (error) =>
            toast.error(getT().structure.failed, { description: errorMessage(error) }),
    });

    const confirmed = !needsTypedConfirmation(action) || confirmation === subject;
    const canRun =
        preview.isSuccess &&
        !preview.isPlaceholderData &&
        confirmed &&
        !isUnchangedRename(action) &&
        !run.isPending;

    const onSubmit = (event: FormEvent) => {
        event.preventDefault();
        if (canRun) {
            run.mutate();
        }
    };

    return (
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
            <DialogHeader>
                <DialogTitle className="break-words">{titleOf(text, initial)}</DialogTitle>
                <DialogDescription>{descriptionOf(text, initial)}</DialogDescription>
            </DialogHeader>

            {value !== null && (
                <div className="flex flex-col gap-1.5">
                    <Label htmlFor={`${id}-name`}>
                        {verb === "rename" ? text.newName : text.name}
                    </Label>
                    <Input
                        id={`${id}-name`}
                        autoFocus
                        spellCheck={false}
                        autoComplete="off"
                        maxLength={128}
                        value={value}
                        onFocus={(event) => event.target.select()}
                        onChange={(event) => setAction(withValue(action, event.target.value))}
                    />
                </div>
            )}

            {action.action === "drop_schema" && (
                <div className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2">
                    <Label htmlFor={`${id}-cascade`} className="font-normal">
                        {text.cascade}
                    </Label>
                    <Switch
                        id={`${id}-cascade`}
                        checked={action.cascade}
                        onCheckedChange={(cascade) => setAction({ ...action, cascade })}
                    />
                </div>
            )}

            {needsTypedConfirmation(action) && (
                <div className="flex flex-col gap-1.5">
                    <Label htmlFor={`${id}-confirm`}>{text.confirmName(subject)}</Label>
                    <Input
                        id={`${id}-confirm`}
                        autoFocus
                        spellCheck={false}
                        autoComplete="off"
                        value={confirmation}
                        onChange={(event) => setConfirmation(event.target.value)}
                    />
                </div>
            )}

            <div className="flex flex-col gap-1.5">
                <span className="text-xs text-muted-foreground">{text.sql}</span>
                {preview.isError && value !== "" ? (
                    <p className="rounded-md border border-destructive/40 px-3 py-2 text-xs text-destructive select-text">
                        {errorMessage(preview.error)}
                    </p>
                ) : (
                    <pre className="min-h-9 rounded-md bg-muted px-3 py-2 font-mono text-xs break-all whitespace-pre-wrap select-text">
                        {preview.data ?? " "}
                    </pre>
                )}
            </div>

            <DialogFooter>
                <Button type="button" variant="ghost" onClick={onDone}>
                    {t.common.cancel}
                </Button>
                <Button
                    type="submit"
                    variant={verb === "drop" || verb === "truncate" ? "destructive" : "default"}
                    disabled={!canRun}
                >
                    {run.isPending && (
                        <Loader2Icon className="animate-spin motion-reduce:animate-none" />
                    )}
                    {text.button[verb]}
                </Button>
            </DialogFooter>
        </form>
    );
}
