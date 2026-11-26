import { useQuery } from "@tanstack/react-query";
import { Loader2Icon } from "lucide-react";
import { useId, useState } from "react";
import { errorMessage } from "@/api/invoke";
import { fetchRows, type Row } from "@/api/query";
import type { ColumnMeta } from "@/bindings/ColumnMeta";
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
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useT } from "@/i18n";
import { findReplacements, type Replacement } from "./findReplace";

const CHUNK = 5000;
const ALL = "all";

async function loadRows(sessionId: string, tabId: string, result: number, total: number) {
    const rows: Row[] = [];
    for (let offset = 0; offset < total; offset += CHUNK) {
        rows.push(...(await fetchRows(sessionId, tabId, result, offset, CHUNK)));
    }
    return rows;
}

export function FindReplaceDialog({
    open,
    sessionId,
    tabId,
    result,
    rowCount,
    columns,
    keyColumns,
    onClose,
    onApply,
}: {
    open: boolean;
    sessionId: string;
    tabId: string;
    result: number;
    rowCount: number;
    columns: ColumnMeta[];
    keyColumns: number[];
    onClose: () => void;
    onApply: (replacements: Replacement[], rows: Row[]) => void;
}) {
    return (
        <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
            <DialogContent className="sm:max-w-lg">
                {open && (
                    <FindReplaceForm
                        sessionId={sessionId}
                        tabId={tabId}
                        result={result}
                        rowCount={rowCount}
                        columns={columns}
                        keyColumns={keyColumns}
                        onClose={onClose}
                        onApply={onApply}
                    />
                )}
            </DialogContent>
        </Dialog>
    );
}

function FindReplaceForm({
    sessionId,
    tabId,
    result,
    rowCount,
    columns,
    keyColumns,
    onClose,
    onApply,
}: {
    sessionId: string;
    tabId: string;
    result: number;
    rowCount: number;
    columns: ColumnMeta[];
    keyColumns: number[];
    onClose: () => void;
    onApply: (replacements: Replacement[], rows: Row[]) => void;
}) {
    const t = useT();
    const text = t.table.findReplace;
    const id = useId();
    const [find, setFind] = useState("");
    const [replace, setReplace] = useState("");
    const [column, setColumn] = useState(ALL);
    const [matchCase, setMatchCase] = useState(false);
    const [wholeCell, setWholeCell] = useState(false);

    const rows = useQuery({
        queryKey: ["find-replace-rows", sessionId, tabId, result, rowCount],
        queryFn: () => loadRows(sessionId, tabId, result, rowCount),
        gcTime: 0,
        staleTime: 0,
    });

    const searchable = columns
        .map((meta, index) => ({ meta, index }))
        .filter(({ meta }) => meta.kind !== "binary");
    const targets =
        column === ALL
            ? searchable
                  .filter(({ index }) => !keyColumns.includes(index))
                  .map(({ index }) => index)
            : [Number(column)];

    const replacements = rows.data
        ? findReplacements(rows.data, targets, { find, replace, matchCase, wholeCell })
        : [];
    const affectedRows = new Set(replacements.map((entry) => entry.row)).size;

    return (
        <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
                event.preventDefault();
                if (rows.data && replacements.length > 0) {
                    onApply(replacements, rows.data);
                }
            }}
        >
            <DialogHeader>
                <DialogTitle>{text.title}</DialogTitle>
                <DialogDescription>{text.description}</DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-1.5">
                <Label htmlFor={`${id}-find`}>{text.find}</Label>
                <Input
                    id={`${id}-find`}
                    autoFocus
                    spellCheck={false}
                    value={find}
                    onChange={(event) => setFind(event.target.value)}
                />
            </div>
            <div className="flex flex-col gap-1.5">
                <Label htmlFor={`${id}-replace`}>{text.replace}</Label>
                <Input
                    id={`${id}-replace`}
                    spellCheck={false}
                    value={replace}
                    onChange={(event) => setReplace(event.target.value)}
                />
            </div>
            <div className="flex flex-col gap-1.5">
                <Label htmlFor={`${id}-column`}>{text.column}</Label>
                <Select value={column} onValueChange={setColumn}>
                    <SelectTrigger id={`${id}-column`} className="w-full">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value={ALL}>{text.allColumns}</SelectItem>
                        {searchable.map(({ meta, index }) => (
                            <SelectItem key={index} value={String(index)}>
                                {meta.name}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>
            <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                    <Switch id={`${id}-case`} checked={matchCase} onCheckedChange={setMatchCase} />
                    <Label htmlFor={`${id}-case`} className="font-normal">
                        {text.matchCase}
                    </Label>
                </div>
                <div className="flex items-center gap-2">
                    <Switch id={`${id}-whole`} checked={wholeCell} onCheckedChange={setWholeCell} />
                    <Label htmlFor={`${id}-whole`} className="font-normal">
                        {text.wholeCell}
                    </Label>
                </div>
            </div>
            <p aria-live="polite" className="min-h-5 text-sm text-muted-foreground">
                {rows.isPending ? (
                    <span className="flex items-center gap-2">
                        <Loader2Icon className="size-4 animate-spin motion-reduce:animate-none" />
                        {text.loading}
                    </span>
                ) : rows.isError ? (
                    <span className="text-destructive">{errorMessage(rows.error)}</span>
                ) : find === "" ? (
                    text.scope(rowCount)
                ) : (
                    text.matches(replacements.length, affectedRows)
                )}
            </p>
            <DialogFooter>
                <Button type="button" variant="ghost" onClick={onClose}>
                    {t.common.cancel}
                </Button>
                <Button type="submit" disabled={replacements.length === 0}>
                    {text.apply(replacements.length)}
                </Button>
            </DialogFooter>
        </form>
    );
}
