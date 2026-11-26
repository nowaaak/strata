import { getCurrentWindow } from "@tauri-apps/api/window";
import { CopyIcon, MinusIcon, SquareIcon, XIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { StrataLogo } from "@/components/brand/StrataLogo";
import { useAppInfo } from "@/features/updater/UpdateCheck";
import { useT } from "@/i18n";
import { cn } from "@/lib/utils";

const IS_MAC = navigator.userAgent.includes("Macintosh");

function useMaximized(): boolean {
    const [maximized, setMaximized] = useState(false);

    useEffect(() => {
        const appWindow = getCurrentWindow();
        let disposed = false;
        let unlisten: (() => void) | undefined;
        const refresh = () =>
            appWindow
                .isMaximized()
                .then((value) => {
                    if (!disposed) {
                        setMaximized(value);
                    }
                })
                .catch(() => undefined);
        void refresh();
        appWindow
            .onResized(() => void refresh())
            .then((fn) => {
                if (disposed) {
                    fn();
                } else {
                    unlisten = fn;
                }
            })
            .catch(() => undefined);
        return () => {
            disposed = true;
            unlisten?.();
        };
    }, []);

    return maximized;
}

function WindowButton({
    label,
    onClick,
    danger,
    children,
}: {
    label: string;
    onClick: () => void;
    danger?: boolean;
    children: React.ReactNode;
}) {
    return (
        <button
            type="button"
            aria-label={label}
            title={label}
            onClick={onClick}
            className={cn(
                "inline-flex h-full w-12 items-center justify-center text-foreground/70 transition-colors outline-none hover:bg-foreground/10 hover:text-foreground focus-visible:bg-foreground/10 motion-reduce:transition-none [&_svg]:size-4",
                danger &&
                    "hover:bg-red-600 hover:text-white focus-visible:bg-red-600 focus-visible:text-white",
            )}
        >
            {children}
        </button>
    );
}

export function TitleBar({ breadcrumb = [] }: { breadcrumb?: string[] }) {
    const t = useT();
    const appInfo = useAppInfo();
    const maximized = useMaximized();
    const appWindow = getCurrentWindow();

    return (
        <div data-tauri-drag-region className="grid grid-cols-[1fr_auto_1fr] items-stretch">
            <div
                data-tauri-drag-region
                className={cn("flex items-center gap-2.5 px-5", IS_MAC && "pl-20")}
            >
                <StrataLogo size={22} className="pointer-events-none" />
                <span className="pointer-events-none text-sm font-semibold tracking-tight">
                    Strata
                </span>
                {appInfo.data?.channel === "dev" && (
                    <span className="pointer-events-none rounded-md bg-amber-500/15 px-1.5 py-0.5 text-[0.6875rem] font-semibold text-amber-600 uppercase dark:text-amber-400">
                        {t.updater.dev}
                    </span>
                )}
            </div>
            <span
                aria-hidden
                className="pointer-events-none flex items-center gap-1.5 text-sm font-medium text-sidebar-foreground/85"
            >
                {breadcrumb.map((part, index) => (
                    <span
                        key={`${index}-${part}`}
                        className={cn(
                            "flex max-w-64 items-center gap-1.5 truncate",
                            index < breadcrumb.length - 1 && "text-sidebar-foreground/60",
                        )}
                    >
                        {index > 0 && <span className="text-sidebar-foreground/35">/</span>}
                        {part}
                    </span>
                ))}
            </span>
            {!IS_MAC && (
                <div className="flex justify-self-end">
                    <WindowButton
                        label={t.app.window.minimize}
                        onClick={() => void appWindow.minimize()}
                    >
                        <MinusIcon />
                    </WindowButton>
                    <WindowButton
                        label={maximized ? t.app.window.restore : t.app.window.maximize}
                        onClick={() => void appWindow.toggleMaximize()}
                    >
                        {maximized ? <CopyIcon className="-scale-x-100" /> : <SquareIcon />}
                    </WindowButton>
                    <WindowButton
                        label={t.app.window.close}
                        danger
                        onClick={() => void appWindow.close()}
                    >
                        <XIcon />
                    </WindowButton>
                </div>
            )}
        </div>
    );
}
