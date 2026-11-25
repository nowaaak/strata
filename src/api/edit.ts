import type { RowChange } from "@/bindings/RowChange";
import type { TableTarget } from "@/bindings/TableTarget";
import { call } from "./invoke";

export const previewChanges = (sessionId: string, target: TableTarget, changes: RowChange[]) =>
    call<string[]>("preview_changes", { sessionId, target, changes });

export const applyChanges = (
    sessionId: string,
    tabId: string,
    target: TableTarget,
    changes: RowChange[],
) => call<number>("apply_changes", { sessionId, tabId, target, changes });
