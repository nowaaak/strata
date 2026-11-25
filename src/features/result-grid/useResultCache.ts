import { useMemo } from "react";
import { toast } from "sonner";
import { errorMessage } from "@/api/invoke";
import { fetchRows } from "@/api/query";
import { getT } from "@/i18n";
import { RowCache } from "./rowCache";

export function useResultCache(
    sessionId: string,
    tabId: string,
    runId: number | undefined,
    result: number | undefined,
): RowCache | null {
    return useMemo(() => {
        if (runId === undefined || result === undefined) {
            return null;
        }
        return new RowCache(
            (offset, limit) => fetchRows(sessionId, tabId, result, offset, limit),
            (error) =>
                toast.error(getT().grid.loadFailed, {
                    id: `rows-${tabId}`,
                    description: errorMessage(error),
                }),
        );
    }, [sessionId, tabId, runId, result]);
}
