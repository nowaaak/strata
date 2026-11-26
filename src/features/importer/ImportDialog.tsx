import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { FileUpIcon, Loader2Icon } from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";
import { csvPreview, importCsv } from "@/api/importer";
import { errorMessage } from "@/api/invoke";
import { describeTable } from "@/api/schema";
import { useUiStore, type ImportRequest } from "@/app/uiStore";
import type { CsvOptions } from "@/bindings/CsvOptions";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { closeWorkspaceTab } from "@/features/connections/connect";
import { sameTarget, useWorkspace } from "@/features/workspace/workspaceStore";
import { getT, useT } from "@/i18n";
import { autoMap, mappedCount, type Mapping } from "./mapping";

const DELIMITERS = {
    auto: null,
    comma: ",",
    semicolon: ";",
    tab: "\t",
    pipe: "|",
} as const;
type DelimiterKey = keyof typeof DELIMITERS;
const SKIP = "skip";

function delimiterName(value: string): string {
    return value === "\t" ? "Tab" : value;
}

export function ImportDialog() {
    const request = useUiStore((ui) => ui.importRequest);
    const close = () => useUiStore.getState().setImportRequest(null);
    return (
        <Dialog open={request !== null} onOpenChange={(open) => !open && close()}>
            <DialogContent className="flex max-h-[calc(100vh-3rem)] flex-col sm:max-w-4xl">
                {request && (
                    <ImportForm key={JSON.stringify(request)} request={request} onDone={close} />
                )}
            </DialogContent>
        </Dialog>
    );
}

function ImportForm({
    request,
    onDone,
}: {
    request: NonNullable<ImportRequest>;
    onDone: () => void;
}) {
    const t = useT();
    const text = t.importer;
    const id = useId();
    const queryClient = useQueryClient();
    const [path, setPath] = useState<string | null>(null);
    const [delimiter, setDelimiter] = useState<DelimiterKey>("auto");
    const [header, setHeader] = useState(true);
    const [emptyAsNull, setEmptyAsNull] = useState(true);
    const [decimalComma, setDecimalComma] = useState(false);
    const [mapping, setMapping] = useState<Mapping | null>(null);
    const [progress, setProgress] = useState(0);

    const options: CsvOptions = { delimiter: DELIMITERS[delimiter], header };
    const info = useQuery({
        queryKey: ["table-info", request.sessionId, request.target],
        queryFn: () => describeTable(request.sessionId, request.target),
        staleTime: 60_000,
    });
    const preview = useQuery({
        queryKey: ["csv-preview", path, options.delimiter, header],
        queryFn: () => csvPreview(path ?? "", options),
        enabled: path !== null,
        retry: false,
        gcTime: 0,
    });

    const columns = info.data?.columns ?? [];
    const headers = preview.data?.headers ?? [];
    const [mappedFor, setMappedFor] = useState<string | null>(null);
    const mappingKey = preview.data ? `${path}|${headers.join("\u0000")}|${header}` : null;
    if (mappingKey !== null && mappingKey !== mappedFor && columns.length > 0) {
        setMappedFor(mappingKey);
        setMapping(
            autoMap(
                columns.map((column) => column.name),
                headers,
                header,
            ),
        );
    }

    const run = useMutation({
        mutationFn: () =>
            importCsv(
                request.sessionId,
                {
                    path: path ?? "",
                    options,
                    target: request.target,
                    mapping: Object.entries(mapping ?? {})
                        .filter((entry): entry is [string, number] => entry[1] !== null)
                        .map(([column, source]) => ({ column, source })),
                    emptyAsNull,
                    decimalComma,
                },
                setProgress,
            ),
        onSuccess: async (summary) => {
            onDone();
            toast.success(getT().importer.done(summary.rows));
            await queryClient.invalidateQueries({
                predicate: (query) => query.queryKey[1] === request.sessionId,
            });
            for (const tab of useWorkspace.getState().tabs) {
                if (tab.kind === "table" && sameTarget(tab.target, request.target)) {
                    closeWorkspaceTab(tab.id);
                    useWorkspace.getState().openTableTab(request.sessionId, request.target);
                }
            }
        },
        onError: (error) => {
            setProgress(0);
            toast.error(getT().importer.failed, {
                description: errorMessage(error),
                duration: 10_000,
            });
        },
    });

    const chooseFile = async () => {
        const chosen = await openFileDialog({
            multiple: false,
            directory: false,
            filters: [{ name: text.fileFilter, extensions: ["csv", "tsv", "txt"] }],
        });
        if (typeof chosen === "string") {
            setPath(chosen);
        }
    };

    const total = preview.data?.totalRows ?? 0;
    const mapped = mapping ? mappedCount(mapping) : 0;
    const fileName = path?.split(/[\\/]/).pop();

    return (
        <>
            <DialogHeader>
                <DialogTitle>{text.title(request.target.table)}</DialogTitle>
                <DialogDescription>{text.description}</DialogDescription>
            </DialogHeader>

            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto pr-1">
                <div className="flex flex-wrap items-center gap-3">
                    <Button
                        variant="outline"
                        onClick={() => void chooseFile()}
                        disabled={run.isPending}
                    >
                        <FileUpIcon />
                        {text.chooseFile}
                    </Button>
                    <span
                        className="min-w-0 truncate font-mono text-xs text-muted-foreground"
                        title={path ?? undefined}
                    >
                        {fileName ?? text.noFile}
                    </span>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                    <div className="flex flex-col gap-1.5">
                        <Label htmlFor={`${id}-delimiter`}>{text.delimiter}</Label>
                        <Select
                            value={delimiter}
                            onValueChange={(value) => setDelimiter(value as DelimiterKey)}
                        >
                            <SelectTrigger id={`${id}-delimiter`} className="w-full">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {(Object.keys(DELIMITERS) as DelimiterKey[]).map((key) => (
                                    <SelectItem key={key} value={key}>
                                        {text.delimiters[key]}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="flex flex-col justify-end gap-2">
                        <OptionSwitch
                            id={`${id}-header`}
                            label={text.header}
                            checked={header}
                            onChange={setHeader}
                        />
                        <OptionSwitch
                            id={`${id}-null`}
                            label={text.emptyAsNull}
                            checked={emptyAsNull}
                            onChange={setEmptyAsNull}
                        />
                        <OptionSwitch
                            id={`${id}-comma`}
                            label={text.decimalComma}
                            checked={decimalComma}
                            onChange={setDecimalComma}
                        />
                    </div>
                </div>

                {preview.isError && (
                    <p className="rounded-md border border-destructive/40 px-3 py-2 text-sm text-destructive select-text">
                        {text.previewFailed}: {errorMessage(preview.error)}
                    </p>
                )}
                {preview.isFetching && (
                    <Loader2Icon className="size-4 animate-spin motion-reduce:animate-none" />
                )}

                {preview.data && mapping && (
                    <>
                        <p className="text-xs text-muted-foreground">
                            {text.detected(
                                preview.data.encoding,
                                delimiterName(preview.data.delimiter),
                                preview.data.totalRows,
                            )}
                        </p>
                        <section className="flex flex-col gap-2">
                            <h3 className="text-sm font-medium">{text.mapping}</h3>
                            <div className="overflow-x-auto rounded-lg border">
                                <table className="w-full border-collapse text-left text-[13px]">
                                    <thead className="bg-muted text-xs text-muted-foreground">
                                        <tr>
                                            <th className="px-3 py-2 font-medium">{text.target}</th>
                                            <th className="px-3 py-2 font-medium">{text.source}</th>
                                            <th className="px-3 py-2 font-medium">
                                                {text.example}
                                            </th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {columns.map((column) => {
                                            const source = mapping[column.name] ?? null;
                                            const example =
                                                source !== null
                                                    ? preview.data.rows[0]?.[source]
                                                    : undefined;
                                            return (
                                                <tr key={column.name} className="border-t">
                                                    <td className="px-3 py-1.5">
                                                        <span className="font-mono text-xs">
                                                            {column.name}
                                                        </span>{" "}
                                                        <span className="text-[11px] text-muted-foreground">
                                                            {column.dataType}
                                                        </span>
                                                    </td>
                                                    <td className="px-3 py-1.5">
                                                        <Select
                                                            value={
                                                                source === null
                                                                    ? SKIP
                                                                    : String(source)
                                                            }
                                                            onValueChange={(value) =>
                                                                setMapping({
                                                                    ...mapping,
                                                                    [column.name]:
                                                                        value === SKIP
                                                                            ? null
                                                                            : Number(value),
                                                                })
                                                            }
                                                        >
                                                            <SelectTrigger
                                                                size="sm"
                                                                aria-label={`${text.source}: ${column.name}`}
                                                                className="h-7 w-56 text-xs"
                                                            >
                                                                <SelectValue />
                                                            </SelectTrigger>
                                                            <SelectContent>
                                                                <SelectItem value={SKIP}>
                                                                    {text.skip}
                                                                </SelectItem>
                                                                {headers.map((name, index) => (
                                                                    <SelectItem
                                                                        key={index}
                                                                        value={String(index)}
                                                                    >
                                                                        {name}
                                                                    </SelectItem>
                                                                ))}
                                                            </SelectContent>
                                                        </Select>
                                                    </td>
                                                    <td className="max-w-60 truncate px-3 py-1.5 font-mono text-xs text-muted-foreground">
                                                        {example}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        </section>
                        <section className="flex flex-col gap-2">
                            <h3 className="text-sm font-medium">{text.preview}</h3>
                            <div className="overflow-x-auto rounded-lg border">
                                <table className="w-full border-collapse text-left font-mono text-xs">
                                    <thead className="bg-muted text-muted-foreground">
                                        <tr>
                                            {headers.map((name, index) => (
                                                <th
                                                    key={index}
                                                    className="px-2 py-1.5 font-medium whitespace-nowrap"
                                                >
                                                    {name}
                                                </th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {preview.data.rows.slice(0, 5).map((row, rowIndex) => (
                                            <tr key={rowIndex} className="border-t">
                                                {headers.map((_, index) => (
                                                    <td
                                                        key={index}
                                                        className="max-w-48 truncate px-2 py-1"
                                                    >
                                                        {row[index] ?? ""}
                                                    </td>
                                                ))}
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </section>
                    </>
                )}
            </div>

            <DialogFooter className="items-center sm:justify-between">
                <span className="text-xs text-muted-foreground tabular-nums" aria-live="polite">
                    {run.isPending
                        ? text.running(progress, total)
                        : preview.data
                          ? text.summary(total, mapped)
                          : ""}
                </span>
                <div className="flex gap-2">
                    <Button variant="ghost" onClick={onDone} disabled={run.isPending}>
                        {t.common.cancel}
                    </Button>
                    <Button
                        onClick={() => run.mutate()}
                        disabled={!preview.data || mapped === 0 || total === 0 || run.isPending}
                    >
                        {run.isPending && (
                            <Loader2Icon className="animate-spin motion-reduce:animate-none" />
                        )}
                        {text.run}
                    </Button>
                </div>
            </DialogFooter>
        </>
    );
}

function OptionSwitch({
    id,
    label,
    checked,
    onChange,
}: {
    id: string;
    label: string;
    checked: boolean;
    onChange: (value: boolean) => void;
}) {
    return (
        <div className="flex items-center gap-2">
            <Switch id={id} checked={checked} onCheckedChange={onChange} />
            <Label htmlFor={id} className="font-normal">
                {label}
            </Label>
        </div>
    );
}
