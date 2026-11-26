import { Channel } from "@tauri-apps/api/core";
import type { CsvImport } from "@/bindings/CsvImport";
import type { CsvOptions } from "@/bindings/CsvOptions";
import type { CsvPreview } from "@/bindings/CsvPreview";
import type { ImportSummary } from "@/bindings/ImportSummary";
import { call } from "./invoke";

export const csvPreview = (path: string, options: CsvOptions) =>
    call<CsvPreview>("csv_preview", { path, options });

export const importCsv = (
    sessionId: string,
    request: CsvImport,
    onProgress: (rows: number) => void,
) => {
    const progress = new Channel<number>();
    progress.onmessage = onProgress;
    return call<ImportSummary>("import_csv", { sessionId, request, onProgress: progress });
};
