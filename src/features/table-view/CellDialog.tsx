import { useId, useState } from "react";
import type { ColumnKind } from "@/bindings/ColumnKind";
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
import { cn } from "@/lib/utils";
import { JsonEditor } from "./JsonEditor";
import { checkJson, isJsonDocument, reformatJson, savedJsonValue } from "@/lib/json";

export type CellDialogState = {
    row: number;
    col: number;
    column: string;
    kind: ColumnKind | null;
    value: string | null;
};

type Mode = "formatted" | "compact" | "text";
const MODES: Mode[] = ["formatted", "compact", "text"];
const JSON_INDENT = 2;

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

function sameJson(a: string, b: string): boolean {
    return checkJson(a).ok && checkJson(b).ok && reformatJson(a, null) === reformatJson(b, null);
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
    const original = state.value ?? "";
    const jsonColumn = state.kind === "json";
    const jsonCapable = jsonColumn || isJsonDocument(state.value);
    const [mode, setMode] = useState<Mode>(jsonCapable ? "formatted" : "text");
    const [value, setValue] = useState(() =>
        jsonCapable && original.trim() !== "" && checkJson(original).ok
            ? reformatJson(original, JSON_INDENT)
            : original,
    );

    const jsonView = jsonCapable && mode !== "text";
    const check = jsonView && value.trim() !== "" ? checkJson(value) : null;
    const invalid = check !== null && !check.ok;
    const blocked = jsonColumn && invalid;
    const unchanged = value === original || (jsonCapable && sameJson(value, original));

    const switchMode = (next: Mode) => {
        if (next !== "text" && value.trim() !== "" && checkJson(value).ok) {
            setValue(reformatJson(value, next === "formatted" ? JSON_INDENT : null));
        }
        setMode(next);
    };

    const apply = () => {
        if (blocked) {
            return;
        }
        if (unchanged) {
            onSave(state.value);
            return;
        }
        onSave(jsonView ? savedJsonValue(state.value, value) : value);
    };

    return (
        <div className="flex flex-col gap-4">
            <DialogHeader>
                <DialogTitle>{text.title(state.column)}</DialogTitle>
                <DialogDescription>
                    {state.value === null ? text.isNull : text.characters(original.length)}
                </DialogDescription>
            </DialogHeader>
            {jsonCapable && (
                <div
                    role="group"
                    aria-label={text.view}
                    className="flex w-fit rounded-lg border p-0.5"
                >
                    {MODES.map((candidate) => (
                        <button
                            key={candidate}
                            type="button"
                            aria-pressed={mode === candidate}
                            onClick={() => switchMode(candidate)}
                            className={cn(
                                "rounded-md px-2.5 py-1 text-xs font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
                                mode === candidate && "bg-muted text-foreground",
                            )}
                        >
                            {text.modes[candidate]}
                        </button>
                    ))}
                </div>
            )}
            {jsonView ? (
                <JsonEditor value={value} label={text.value} onChange={setValue} onSubmit={apply} />
            ) : (
                <>
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
                                apply();
                            }
                        }}
                        className="h-80 w-full resize-y rounded-lg border border-input bg-transparent p-3 font-mono text-[13px] outline-none focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
                    />
                </>
            )}
            {check && !check.ok && (
                <p
                    aria-live="polite"
                    className={cn(
                        "text-xs select-text",
                        blocked ? "text-destructive" : "text-amber-600 dark:text-amber-400",
                    )}
                >
                    {check.line !== null && check.column !== null
                        ? text.invalidJsonAt(check.line, check.column)
                        : `${text.invalidJson} ${check.message}`}{" "}
                    {!blocked && text.invalidJsonAllowed}
                </p>
            )}
            <DialogFooter className="sm:justify-between">
                <Button variant="outline" onClick={() => onSave(null)}>
                    {text.setNull}
                </Button>
                <div className="flex gap-2">
                    <Button variant="ghost" onClick={onClose}>
                        {t.common.cancel}
                    </Button>
                    <Button onClick={apply} disabled={blocked}>
                        {text.apply}
                    </Button>
                </div>
            </DialogFooter>
        </div>
    );
}
