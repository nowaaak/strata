import type { SavedWorkspace } from "@/bindings/SavedWorkspace";
import { call } from "./invoke";

export const loadWorkspace = () => call<SavedWorkspace>("load_workspace");

export const saveWorkspace = (workspace: SavedWorkspace) =>
    call<void>("save_workspace", { workspace });
