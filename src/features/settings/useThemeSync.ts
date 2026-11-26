import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { errorMessage } from "@/api/invoke";
import { getT, resolveLocale, setLocale } from "@/i18n";
import { DEFAULT_SETTINGS, resolveTheme, type ResolvedTheme } from "./theme";
import { useSettings } from "./useSettings";

const DARK_QUERY = "(prefers-color-scheme: dark)";

function resolveCssColor(value: string): [number, number, number] | null {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context || value === "") {
        return null;
    }
    context.fillStyle = value;
    context.fillRect(0, 0, 1, 1);
    const [red = 0, green = 0, blue = 0] = context.getImageData(0, 0, 1, 1).data;
    return [red, green, blue];
}

function syncWindowBackground() {
    const background = getComputedStyle(document.body).backgroundColor;
    const rgb = resolveCssColor(background);
    if (!rgb) {
        return;
    }
    getCurrentWebviewWindow()
        .setBackgroundColor([...rgb, 255])
        .catch((error: unknown) => console.warn("window background could not be set", error));
}

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
        syncWindowBackground();
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
