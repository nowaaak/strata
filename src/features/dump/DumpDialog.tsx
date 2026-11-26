import { useQuery } from "@tanstack/react-query";
import { save } from "@tauri-apps/plugin-dialog";
import { EyeIcon, Loader2Icon, Table2Icon } from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";
import { errorMessage } from "@/api/invoke";
import { cancelExport, dumpDatabase } from "@/api/query";
import { listObjects } from "@/api/schema";
import { useUiStore, type DumpRequest } from "@/app/uiStore";
import type { DumpOptions } from "@/bindings/DumpOptions";
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
import { Switch } from "@/components/ui/switch";
import { getT, useT } from "@/i18n";

export function DumpDialog() {
    const request = useUiStore((ui) => ui.dumpRequest);
    const close = () => useUiStore.getState().setDumpRequest(null);
    return (
        <Dialog open={request !== null} onOpenChange={(open) => !open && close()}>
            <DialogContent className="flex max-h-[calc(100vh-3rem)] flex-col sm:max-w-lg">
                {request && (
                    <DumpForm key={JSON.stringify(request)} request={request} onDone={close} />
                )}
            </DialogContent>
        </Dialog>
    );
}

async function runDump(sessionId: string, options: DumpOptions, path: string) {
    const text = getT().dump;
    const exportId = crypto.randomUUID();
    const action = {
        label: text.cancel,
        onClick: () => {
            void cancelExport(sessionId, exportId);
        },
    };
    toast.loading(text.running(options.schema ?? options.database, 0, 1, 0), {
        id: exportId,
        action,
        duration: Infinity,
    });
    try {
        const summary = await dumpDatabase(sessionId, exportId, options, path, (progress) =>
            toast.loading(
                text.running(progress.table, progress.done, progress.total, progress.rows),
                {
                    id: exportId,
                    action,
                    duration: Infinity,
                },
            ),
        );
        if (summary.cancelled) {
            toast.info(text.cancelled, { id: exportId, action: undefined, duration: 4000 });
        } else {
            toast.success(text.done(summary.tables, summary.rows), {
                id: exportId,
                description: path,
                action: undefined,
                duration: 5000,
            });
        }
    } catch (error) {
        toast.error(text.failed, {
            id: exportId,
            description: errorMessage(error),
            action: undefined,
            duration: 8000,
        });
    }
}

function DumpForm({ request, onDone }: { request: NonNullable<DumpRequest>; onDone: () => void }) {
    const t = useT();
    const text = t.dump;
    const id = useId();
    const [excluded, setExcluded] = useState<Set<string>>(new Set());
    const [structure, setStructure] = useState(true);
    const [data, setData] = useState(true);
    const [dropExisting, setDropExisting] = useState(true);
    const [routines, setRoutines] = useState(true);

    const objects = useQuery({
        queryKey: ["objects", request.sessionId, request.database, request.schema],
        queryFn: () => listObjects(request.sessionId, request.database, request.schema),
        staleTime: 60_000,
    });
    const all = objects.data ?? [];
    const chosen = all.filter((object) => !excluded.has(object.name));
    const name = request.schema ? `${request.database}.${request.schema}` : request.database;

    const start = async () => {
        try {
            const path = await save({
                defaultPath: `${request.schema ?? request.database}.sql`,
                filters: [{ name: text.fileFilter, extensions: ["sql"] }],
            });
            if (!path) {
                return;
            }
            onDone();
            void runDump(
                request.sessionId,
                {
                    database: request.database,
                    schema: request.schema,
                    tables: chosen.length === all.length ? [] : chosen.map((object) => object.name),
                    structure,
                    data,
                    dropExisting: dropExisting && structure,
                    routines: routines && structure,
                },
                path,
            );
        } catch (error) {
            toast.error(text.failed, { description: errorMessage(error) });
        }
    };

    return (
        <>
            <DialogHeader>
                <DialogTitle>{text.title(name)}</DialogTitle>
                <DialogDescription>{text.description}</DialogDescription>
            </DialogHeader>
            <div className="flex min-h-0 flex-1 flex-col gap-3">
                <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">{text.objects}</span>
                    <span className="flex gap-1">
                        <Button variant="ghost" size="xs" onClick={() => setExcluded(new Set())}>
                            {text.all}
                        </Button>
                        <Button
                            variant="ghost"
                            size="xs"
                            onClick={() => setExcluded(new Set(all.map((object) => object.name)))}
                        >
                            {text.none}
                        </Button>
                    </span>
                </div>
                <ul className="max-h-64 min-h-24 overflow-auto rounded-lg border p-1">
                    {objects.isPending && (
                        <li className="flex items-center gap-2 p-3 text-sm text-muted-foreground">
                            <Loader2Icon className="size-4 animate-spin motion-reduce:animate-none" />
                            {text.loading}
                        </li>
                    )}
                    {objects.isError && (
                        <li className="p-3 text-sm text-destructive">
                            {errorMessage(objects.error)}
                        </li>
                    )}
                    {objects.data?.length === 0 && (
                        <li className="p-3 text-sm text-muted-foreground">{text.empty}</li>
                    )}
                    {all.map((object) => {
                        const Icon = object.kind === "view" ? EyeIcon : Table2Icon;
                        return (
                            <li key={object.name}>
                                <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-[13px] hover:bg-accent">
                                    <input
                                        type="checkbox"
                                        className="size-4 accent-[var(--primary)]"
                                        checked={!excluded.has(object.name)}
                                        onChange={(event) => {
                                            const next = new Set(excluded);
                                            if (event.target.checked) {
                                                next.delete(object.name);
                                            } else {
                                                next.add(object.name);
                                            }
                                            setExcluded(next);
                                        }}
                                    />
                                    <Icon className="size-3.5 text-muted-foreground" aria-hidden />
                                    <span className="truncate">{object.name}</span>
                                </label>
                            </li>
                        );
                    })}
                </ul>
                <span className="text-xs text-muted-foreground">
                    {text.selected(chosen.length, all.length)}
                </span>
                <OptionSwitch
                    id={`${id}-structure`}
                    label={text.structure}
                    checked={structure}
                    onChange={setStructure}
                />
                <OptionSwitch
                    id={`${id}-routines`}
                    label={request.schema === null ? text.routinesMysql : text.routines}
                    checked={routines && structure}
                    disabled={!structure}
                    onChange={setRoutines}
                />
                <OptionSwitch
                    id={`${id}-data`}
                    label={text.data}
                    checked={data}
                    onChange={setData}
                />
                <OptionSwitch
                    id={`${id}-drop`}
                    label={text.dropExisting}
                    checked={dropExisting && structure}
                    disabled={!structure}
                    onChange={setDropExisting}
                />
            </div>
            <DialogFooter>
                <Button variant="ghost" onClick={onDone}>
                    {t.common.cancel}
                </Button>
                <Button
                    disabled={chosen.length === 0 || (!structure && !data)}
                    onClick={() => void start()}
                >
                    {text.run}
                </Button>
            </DialogFooter>
        </>
    );
}

function OptionSwitch({
    id,
    label,
    checked,
    disabled,
    onChange,
}: {
    id: string;
    label: string;
    checked: boolean;
    disabled?: boolean;
    onChange: (value: boolean) => void;
}) {
    return (
        <div className="flex items-center gap-2">
            <Switch id={id} checked={checked} disabled={disabled} onCheckedChange={onChange} />
            <Label htmlFor={id} className="font-normal">
                {label}
            </Label>
        </div>
    );
}
