import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { useT } from "@/i18n";

export type CellDialogState = { row: number; col: number; column: string; value: string | null };

export function CellDialog({
    state,
    onClose,
    onSave,
}: {
    state: CellDialogState | null;
    onClose: () => void;
    onSave: (value: string | null) => void;
}) {
    return (
        <Dialog open={state !== null} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="sm:max-w-2xl">
                {state && (
                    <CellForm
                        key={`${state.row}:${state.col}`}
                        state={state}
                        onClose={onClose}
                        onSave={onSave}
                    />
                )}
            </DialogContent>
        </Dialog>
    );
}

function CellForm({
    state,
    onClose,
    onSave,
}: {
    state: CellDialogState;
    onClose: () => void;
    onSave: (value: string | null) => void;
}) {
    const t = useT();
    const text = t.table.cell;
    const id = useId();
    const [value, setValue] = useState(state.value ?? "");

    return (
        <div className="flex flex-col gap-4">
            <DialogHeader>
                <DialogTitle>{text.title(state.column)}</DialogTitle>
                <DialogDescription>
                    {state.value === null ? text.isNull : text.characters(value.length)}
                </DialogDescription>
            </DialogHeader>
            <label htmlFor={id} className="sr-only">
                {text.value}
            </label>
            <textarea
                id={id}
                autoFocus
                spellCheck={false}
                value={value}
                onChange={(event) => setValue(event.target.value)}
                onKeyDown={(event) => {
                    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                        event.preventDefault();
                        onSave(value);
                    }
                }}
                className="h-72 w-full resize-y rounded-lg border border-input bg-transparent p-3 font-mono text-[13px] outline-none focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
            />
            <DialogFooter className="sm:justify-between">
                <Button variant="outline" onClick={() => onSave(null)}>
                    {text.setNull}
                </Button>
                <div className="flex gap-2">
                    <Button variant="ghost" onClick={onClose}>
                        {t.common.cancel}
                    </Button>
                    <Button onClick={() => onSave(value)}>{text.apply}</Button>
                </div>
            </DialogFooter>
        </div>
    );
}
