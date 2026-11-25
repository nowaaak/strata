import { save } from "@tauri-apps/plugin-dialog";
import { DownloadIcon } from "lucide-react";
import { toast } from "sonner";
import { errorMessage } from "@/api/invoke";
import { exportResult } from "@/api/query";
import type { ExportFormat } from "@/bindings/ExportFormat";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useT } from "@/i18n";

const FORMATS: { format: ExportFormat; extension: string }[] = [
    { format: "csv", extension: "csv" },
    { format: "json", extension: "json" },
];

export function ExportMenu({
    sessionId,
    tabId,
    result,
    baseName,
    disabled,
}: {
    sessionId: string;
    tabId: string;
    result: number;
    baseName: string;
    disabled?: boolean;
}) {
    const t = useT();
    const run = async (format: ExportFormat, extension: string) => {
        try {
            const path = await save({
                defaultPath: `${baseName}.${extension}`,
                filters: [{ name: extension.toUpperCase(), extensions: [extension] }],
            });
            if (!path) {
                return;
            }
            const count = await exportResult(sessionId, tabId, result, format, path);
            toast.success(t.query.export.done(count), { description: path });
        } catch (error) {
            toast.error(t.query.export.failed, { description: errorMessage(error) });
        }
    };

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="xs" disabled={disabled}>
                    <DownloadIcon />
                    {t.query.export.button}
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
                {FORMATS.map(({ format, extension }) => (
                    <DropdownMenuItem key={format} onSelect={() => void run(format, extension)}>
                        {t.query.export[format]}
                    </DropdownMenuItem>
                ))}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
