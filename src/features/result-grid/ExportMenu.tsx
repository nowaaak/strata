import { save } from "@tauri-apps/plugin-dialog";
import { DownloadIcon } from "lucide-react";
import { toast } from "sonner";
import { errorMessage } from "@/api/invoke";
import { cancelExport, exportFull, exportResult } from "@/api/query";
import type { ExportFormat } from "@/bindings/ExportFormat";
import type { ExportSource } from "@/bindings/ExportSource";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { getT, useT } from "@/i18n";

const FORMATS: { format: ExportFormat; extension: string }[] = [
    { format: "csv", extension: "csv" },
    { format: "json", extension: "json" },
];

async function choosePath(baseName: string, extension: string): Promise<string | null> {
    return save({
        defaultPath: `${baseName}.${extension}`,
        filters: [{ name: extension.toUpperCase(), extensions: [extension] }],
    });
}

async function runFull(
    sessionId: string,
    source: ExportSource,
    format: ExportFormat,
    path: string,
) {
    const text = getT().query.export;
    const exportId = crypto.randomUUID();
    const cancel = {
        label: text.cancel,
        onClick: () => {
            void cancelExport(sessionId, exportId);
        },
    };
    toast.loading(text.running(0), { id: exportId, action: cancel, duration: Infinity });
    try {
        const summary = await exportFull(sessionId, exportId, source, format, path, (rows) =>
            toast.loading(text.running(rows), { id: exportId, action: cancel, duration: Infinity }),
        );
        if (summary.cancelled) {
            toast.info(text.cancelled(summary.rows), {
                id: exportId,
                action: undefined,
                duration: 4000,
            });
        } else {
            toast.success(text.done(summary.rows), {
                id: exportId,
                description: path,
                action: undefined,
                duration: 4000,
            });
        }
    } catch (error) {
        toast.error(text.failed, {
            id: exportId,
            description: errorMessage(error),
            action: undefined,
            duration: 6000,
        });
    }
}

export function ExportMenu({
    sessionId,
    tabId,
    result,
    baseName,
    disabled,
    fullSource,
}: {
    sessionId: string;
    tabId: string;
    result: number;
    baseName: string;
    disabled?: boolean;
    fullSource?: ExportSource | null;
}) {
    const t = useT();
    const text = t.query.export;

    const exportLoaded = async (format: ExportFormat, extension: string) => {
        try {
            const path = await choosePath(baseName, extension);
            if (!path) {
                return;
            }
            const count = await exportResult(sessionId, tabId, result, format, path);
            toast.success(text.done(count), { description: path });
        } catch (error) {
            toast.error(text.failed, { description: errorMessage(error) });
        }
    };

    const exportAll = async (source: ExportSource, format: ExportFormat, extension: string) => {
        try {
            const path = await choosePath(baseName, extension);
            if (path) {
                void runFull(sessionId, source, format, path);
            }
        } catch (error) {
            toast.error(text.failed, { description: errorMessage(error) });
        }
    };

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="xs" disabled={disabled}>
                    <DownloadIcon />
                    {text.button}
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
                {fullSource && <DropdownMenuLabel>{text.loaded}</DropdownMenuLabel>}
                {FORMATS.map(({ format, extension }) => (
                    <DropdownMenuItem
                        key={format}
                        onSelect={() => void exportLoaded(format, extension)}
                    >
                        {text[format]}
                    </DropdownMenuItem>
                ))}
                {fullSource && (
                    <>
                        <DropdownMenuSeparator />
                        <DropdownMenuLabel>{text.full}</DropdownMenuLabel>
                        {FORMATS.map(({ format, extension }) => (
                            <DropdownMenuItem
                                key={`full-${format}`}
                                onSelect={() => void exportAll(fullSource, format, extension)}
                            >
                                {format === "csv" ? text.fullCsv : text.fullJson}
                            </DropdownMenuItem>
                        ))}
                    </>
                )}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
