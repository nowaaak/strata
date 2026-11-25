import type { Settings } from "@/bindings/Settings";
import { call } from "./invoke";

export const getSettings = () => call<Settings>("get_settings");

export const updateSettings = (settings: Settings) =>
    call<Settings>("update_settings", { settings });
