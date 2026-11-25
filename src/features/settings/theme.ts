import type { Accent } from "@/bindings/Accent";
import type { GridDensity } from "@/bindings/GridDensity";
import type { Language } from "@/bindings/Language";
import type { Settings } from "@/bindings/Settings";
import type { Theme } from "@/bindings/Theme";

export type ResolvedTheme = "light" | "dark";

export const DEFAULT_SETTINGS: Settings = {
    theme: "dark",
    accent: "violet",
    language: "system",
    zoom: 100,
    editorFontSize: 13,
    editorWordWrap: false,
    gridDensity: "normal",
    defaultRowLimit: 1_000,
};

export const THEMES: Theme[] = ["dark", "light", "system"];
export const ACCENTS: Accent[] = ["violet", "blue", "teal", "green", "amber", "rose"];
export const LANGUAGES: Language[] = ["system", "de", "en"];
export const DENSITIES: GridDensity[] = ["compact", "normal", "comfortable"];
export const ZOOM_LEVELS = [80, 90, 100, 110, 125, 150];
export const EDITOR_FONT_SIZES = [11, 12, 13, 14, 15, 16, 18, 20];
export const ROW_LIMITS = [1_000, 10_000, 100_000, 1_000_000];

export const ACCENT_SWATCHES: Record<Accent, string> = {
    violet: "oklch(0.6 0.21 277)",
    blue: "oklch(0.6 0.19 245)",
    teal: "oklch(0.68 0.12 190)",
    green: "oklch(0.66 0.16 150)",
    amber: "oklch(0.74 0.16 65)",
    rose: "oklch(0.64 0.2 10)",
};

export const ROW_HEIGHTS: Record<GridDensity, number> = {
    compact: 22,
    normal: 26,
    comfortable: 32,
};

export function resolveTheme(theme: Theme, systemDark: boolean): ResolvedTheme {
    if (theme === "system") {
        return systemDark ? "dark" : "light";
    }
    return theme;
}

export function withOption(options: number[], value: number): number[] {
    return options.includes(value) ? options : [...options, value].sort((a, b) => a - b);
}
