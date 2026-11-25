import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { errorMessage } from "@/api/invoke";
import { getT, resolveLocale, setLocale } from "@/i18n";
import { DEFAULT_SETTINGS, resolveTheme, type ResolvedTheme } from "./theme";
import { useSettings } from "./useSettings";

const DARK_QUERY = "(prefers-color-scheme: dark)";

export function useResolvedTheme(): ResolvedTheme {
    const theme = useSettings().data?.theme ?? DEFAULT_SETTINGS.theme;
    const [systemDark, setSystemDark] = useState(() => window.matchMedia(DARK_QUERY).matches);

    useEffect(() => {
        const media = window.matchMedia(DARK_QUERY);
        const onChange = (event: MediaQueryListEvent) => setSystemDark(event.matches);
        media.addEventListener("change", onChange);
        return () => media.removeEventListener("change", onChange);
    }, []);

    const resolved = resolveTheme(theme, systemDark);

    useEffect(() => {
        document.documentElement.classList.toggle("dark", resolved === "dark");
        document.documentElement.style.colorScheme = resolved;
    }, [resolved]);

    return resolved;
}

export function useApplySettings() {
    const settings = useSettings().data ?? DEFAULT_SETTINGS;
    const { accent, language, zoom, editorFontSize } = settings;

    useEffect(() => {
        document.documentElement.dataset.accent = accent;
    }, [accent]);

    useEffect(() => {
        document.documentElement.style.setProperty("--editor-font-size", `${editorFontSize}px`);
    }, [editorFontSize]);

    useEffect(() => {
        setLocale(resolveLocale(language));
    }, [language]);

    useEffect(() => {
        getCurrentWebview()
            .setZoom(zoom / 100)
            .catch((error: unknown) =>
                toast.error(getT().settings.zoomFailed, { description: errorMessage(error) }),
            );
    }, [zoom]);
}
