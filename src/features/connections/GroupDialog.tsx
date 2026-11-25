import { useId, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useT } from "@/i18n";

export type GroupDialogState =
    { mode: "create"; profileId: string } | { mode: "rename"; group: string } | null;

export function GroupDialog({
    state,
    onClose,
    onSubmit,
}: {
    state: GroupDialogState;
    onClose: () => void;
    onSubmit: (name: string) => void;
}) {
    const key = state
        ? state.mode === "create"
            ? `c:${state.profileId}`
            : `r:${state.group}`
        : "";
    return (
        <Dialog open={state !== null} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="sm:max-w-sm">
                {state && (
                    <GroupForm key={key} state={state} onClose={onClose} onSubmit={onSubmit} />
                )}
            </DialogContent>
        </Dialog>
    );
}

function GroupForm({
    state,
    onClose,
    onSubmit,
}: {
    state: NonNullable<GroupDialogState>;
    onClose: () => void;
    onSubmit: (name: string) => void;
}) {
    const t = useT();
    const text = t.connections.group;
    const id = useId();
    const [name, setName] = useState(state.mode === "rename" ? state.group : "");
    const trimmed = name.trim();

    const submit = (event: FormEvent) => {
        event.preventDefault();
        if (trimmed) {
            onSubmit(trimmed);
        }
    };

    return (
        <form onSubmit={submit} className="flex flex-col gap-4">
            <DialogHeader>
                <DialogTitle>
                    {state.mode === "rename" ? text.renameTitle : text.newTitle}
                </DialogTitle>
            </DialogHeader>
            <div className="flex flex-col gap-1.5">
                <Label htmlFor={id}>{text.label}</Label>
                <Input
                    id={id}
                    autoFocus
                    maxLength={60}
                    placeholder={text.placeholder}
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                />
            </div>
            <DialogFooter>
                <Button type="button" variant="ghost" onClick={onClose}>
                    {t.common.cancel}
                </Button>
                <Button type="submit" disabled={!trimmed}>
                    {t.common.save}
                </Button>
            </DialogFooter>
        </form>
    );
}
