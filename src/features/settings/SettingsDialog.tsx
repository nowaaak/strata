import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getVersion } from "@tauri-apps/api/app";
import {
    ClipboardCopyIcon,
    CodeIcon,
    InfoIcon,
    LanguagesIcon,
    Trash2Icon,
    MonitorIcon,
    MoonIcon,
    PaletteIcon,
    RotateCcwIcon,
    SunIcon,
    type LucideIcon,
} from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { clearHistory, historyKey } from "@/api/history";
import { errorMessage } from "@/api/invoke";
import { appPaths } from "@/api/settings";
import { useUiStore } from "@/app/uiStore";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { Settings } from "@/bindings/Settings";
import type { Theme } from "@/bindings/Theme";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { formatCount } from "@/features/result-grid/format";
import { useT } from "@/i18n";
import { cn } from "@/lib/utils";
import {
    ACCENT_SWATCHES,
    ACCENTS,
    DEFAULT_SETTINGS,
    DENSITIES,
    EDITOR_FONT_SIZES,
    LANGUAGES,
    ROW_LIMITS,
    THEMES,
    withOption,
    ZOOM_LEVELS,
} from "./theme";
import { useSettings, useUpdateSettings } from "./useSettings";

type Section = "appearance" | "editor" | "language" | "about";

const SECTIONS: { section: Section; icon: LucideIcon }[] = [
    { section: "appearance", icon: PaletteIcon },
    { section: "editor", icon: CodeIcon },
    { section: "language", icon: LanguagesIcon },
    { section: "about", icon: InfoIcon },
];

const THEME_ICONS: Record<Theme, LucideIcon> = {
    dark: MoonIcon,
    light: SunIcon,
    system: MonitorIcon,
};

export function SettingsDialog() {
    const t = useT();
    const open = useUiStore((ui) => ui.settingsOpen);
    const setOpen = useUiStore((ui) => ui.setSettingsOpen);

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-2xl">
                <DialogHeader className="border-b p-4">
                    <DialogTitle>{t.settings.title}</DialogTitle>
                    <DialogDescription>{t.settings.description}</DialogDescription>
                </DialogHeader>
                {open && <SettingsBody />}
            </DialogContent>
        </Dialog>
    );
}

function SettingsBody() {
    const t = useT();
    const settings = useSettings().data;
    const update = useUpdateSettings();
    const [section, setSection] = useState<Section>("appearance");

    if (!settings) {
        return null;
    }
    const change = (patch: Partial<Settings>) => update.mutate({ ...settings, ...patch });

    return (
        <div className="grid min-h-96 grid-cols-[13rem_minmax(0,1fr)]">
            <nav
                aria-label={t.settings.title}
                className="flex flex-col gap-0.5 border-r bg-muted/30 p-2"
            >
                {SECTIONS.map(({ section: entry, icon: Icon }) => (
                    <button
                        key={entry}
                        type="button"
                        aria-current={section === entry ? "page" : undefined}
                        onClick={() => setSection(entry)}
                        className={cn(
                            "flex h-8 items-center gap-2 rounded-md px-2.5 text-left text-sm text-muted-foreground outline-none hover:bg-accent/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
                            section === entry && "bg-accent text-foreground",
                        )}
                    >
                        <Icon className="size-4" aria-hidden />
                        {t.settings.sections[entry]}
                    </button>
                ))}
                <Button
                    variant="ghost"
                    size="sm"
                    className="mt-auto justify-start text-muted-foreground"
                    onClick={() => update.mutate(DEFAULT_SETTINGS)}
                >
                    <RotateCcwIcon />
                    {t.settings.reset}
                </Button>
            </nav>
            <div className="flex flex-col gap-5 p-5">
                {section === "appearance" && (
                    <>
                        <Field label={t.settings.theme}>
                            <Segmented
                                label={t.settings.theme}
                                value={settings.theme}
                                options={THEMES.map((theme) => ({
                                    value: theme,
                                    label: t.settings.themes[theme],
                                    icon: THEME_ICONS[theme],
                                }))}
                                onChange={(theme) => change({ theme })}
                            />
                        </Field>
                        <Field label={t.settings.accent}>
                            <div
                                role="radiogroup"
                                aria-label={t.settings.accent}
                                className="flex gap-2"
                            >
                                {ACCENTS.map((accent) => (
                                    <button
                                        key={accent}
                                        type="button"
                                        role="radio"
                                        aria-checked={settings.accent === accent}
                                        aria-label={t.settings.accents[accent]}
                                        title={t.settings.accents[accent]}
                                        onClick={() => change({ accent })}
                                        className={cn(
                                            "flex size-8 items-center justify-center rounded-full ring-offset-2 ring-offset-background outline-none focus-visible:ring-2 focus-visible:ring-ring",
                                            settings.accent === accent &&
                                                "ring-2 ring-foreground/70",
                                        )}
                                    >
                                        <span
                                            className="size-6 rounded-full"
                                            style={{ backgroundColor: ACCENT_SWATCHES[accent] }}
                                        />
                                    </button>
                                ))}
                            </div>
                        </Field>
                        <Field label={t.settings.zoom} hint={t.settings.zoomHint}>
                            {(id) => (
                                <NumberSelect
                                    id={id}
                                    value={settings.zoom}
                                    options={withOption(ZOOM_LEVELS, settings.zoom)}
                                    format={(value) => `${value} %`}
                                    onChange={(zoom) => change({ zoom })}
                                />
                            )}
                        </Field>
                    </>
                )}
                {section === "editor" && (
                    <>
                        <Field label={t.settings.editorFontSize}>
                            {(id) => (
                                <NumberSelect
                                    id={id}
                                    value={settings.editorFontSize}
                                    options={withOption(EDITOR_FONT_SIZES, settings.editorFontSize)}
                                    format={t.settings.pixels}
                                    onChange={(editorFontSize) => change({ editorFontSize })}
                                />
                            )}
                        </Field>
                        <SwitchField
                            label={t.settings.wordWrap}
                            checked={settings.editorWordWrap}
                            onChange={(editorWordWrap) => change({ editorWordWrap })}
                        />
                        <Field label={t.settings.gridDensity}>
                            <Segmented
                                label={t.settings.gridDensity}
                                value={settings.gridDensity}
                                options={DENSITIES.map((density) => ({
                                    value: density,
                                    label: t.settings.densities[density],
                                }))}
                                onChange={(gridDensity) => change({ gridDensity })}
                            />
                        </Field>
                        <Field label={t.settings.defaultRowLimit}>
                            {(id) => (
                                <NumberSelect
                                    id={id}
                                    value={settings.defaultRowLimit}
                                    options={withOption(ROW_LIMITS, settings.defaultRowLimit)}
                                    format={formatCount}
                                    onChange={(defaultRowLimit) => change({ defaultRowLimit })}
                                />
                            )}
                        </Field>
                        <SwitchField
                            label={t.settings.history}
                            checked={settings.historyEnabled}
                            onChange={(historyEnabled) => change({ historyEnabled })}
                        />
                        <p className="-mt-3 text-xs text-muted-foreground">
                            {t.settings.historyHint}
                        </p>
                        <ClearHistoryButton />
                    </>
                )}
                {section === "about" && <About />}
                {section === "language" && (
                    <Field label={t.settings.language}>
                        <Segmented
                            label={t.settings.language}
                            value={settings.language}
                            options={LANGUAGES.map((language) => ({
                                value: language,
                                label: t.settings.languages[language],
                            }))}
                            onChange={(language) => change({ language })}
                        />
                    </Field>
                )}
            </div>
        </div>
    );
}

function Field({
    label,
    hint,
    children,
}: {
    label: string;
    hint?: string;
    children: ReactNode | ((id: string) => ReactNode);
}) {
    const id = useId();
    const control = typeof children === "function";
    return (
        <div className="flex flex-col gap-2">
            {control ? (
                <Label htmlFor={id}>{label}</Label>
            ) : (
                <span className="text-sm leading-none font-medium">{label}</span>
            )}
            {typeof children === "function" ? children(id) : children}
            {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
        </div>
    );
}

function SwitchField({
    label,
    checked,
    onChange,
}: {
    label: string;
    checked: boolean;
    onChange: (checked: boolean) => void;
}) {
    const id = useId();
    return (
        <div className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5">
            <Label htmlFor={id} className="font-normal">
                {label}
            </Label>
            <Switch id={id} checked={checked} onCheckedChange={onChange} />
        </div>
    );
}

function NumberSelect({
    id,
    value,
    options,
    format,
    onChange,
}: {
    id: string;
    value: number;
    options: number[];
    format: (value: number) => string;
    onChange: (value: number) => void;
}) {
    return (
        <Select value={String(value)} onValueChange={(next) => onChange(Number(next))}>
            <SelectTrigger id={id} className="w-44 tabular-nums">
                <SelectValue />
            </SelectTrigger>
            <SelectContent>
                {options.map((option) => (
                    <SelectItem key={option} value={String(option)}>
                        {format(option)}
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    );
}

function Segmented<T extends string>({
    label,
    value,
    options,
    onChange,
}: {
    label: string;
    value: T;
    options: { value: T; label: string; icon?: LucideIcon }[];
    onChange: (value: T) => void;
}) {
    return (
        <div
            role="radiogroup"
            aria-label={label}
            className="inline-flex w-fit rounded-lg bg-muted p-0.5"
        >
            {options.map((option) => (
                <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={value === option.value}
                    onClick={() => onChange(option.value)}
                    className={cn(
                        "flex h-7 items-center gap-1.5 rounded-md px-3 text-sm text-muted-foreground transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none",
                        value === option.value && "bg-background text-foreground shadow-sm",
                    )}
                >
                    {option.icon && <option.icon className="size-3.5" aria-hidden />}
                    {option.label}
                </button>
            ))}
        </div>
    );
}

function ClearHistoryButton() {
    const t = useT();
    const queryClient = useQueryClient();
    const [open, setOpen] = useState(false);

    const clear = async () => {
        try {
            const removed = await clearHistory(null);
            await queryClient.invalidateQueries({ queryKey: historyKey });
            toast.success(t.settings.historyCleared(formatCount(removed)));
        } catch (error) {
            toast.error(t.settings.clearFailed, { description: errorMessage(error) });
        } finally {
            setOpen(false);
        }
    };

    return (
        <>
            <Button variant="outline" size="sm" className="w-fit" onClick={() => setOpen(true)}>
                <Trash2Icon />
                {t.settings.clearHistory}
            </Button>
            <AlertDialog open={open} onOpenChange={setOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>{t.settings.clearHistoryTitle}</AlertDialogTitle>
                        <AlertDialogDescription>
                            {t.settings.clearHistoryDescription}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>{t.common.cancel}</AlertDialogCancel>
                        <AlertDialogAction
                            variant="destructive"
                            onClick={(event) => {
                                event.preventDefault();
                                void clear();
                            }}
                        >
                            {t.settings.clearHistory}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    );
}

function PathRow({ label, path, hint }: { label: string; path: string; hint?: string }) {
    const t = useT();
    const copy = async () => {
        try {
            await navigator.clipboard.writeText(path);
            toast.success(t.common.copied(t.settings.path));
        } catch (error) {
            toast.error(t.common.copyFailed, { description: errorMessage(error) });
        }
    };
    return (
        <div className="flex flex-col gap-1.5">
            <span className="text-sm leading-none font-medium">{label}</span>
            <div className="flex items-center gap-2">
                <code
                    title={path}
                    className="min-w-0 flex-1 truncate rounded-md bg-muted px-2 py-1.5 font-mono text-xs select-text"
                >
                    {path}
                </code>
                <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t.settings.copyPath}
                    title={t.settings.copyPath}
                    onClick={() => void copy()}
                >
                    <ClipboardCopyIcon />
                </Button>
            </div>
            {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
        </div>
    );
}

function About() {
    const t = useT();
    const version = useQuery({
        queryKey: ["app-version"],
        queryFn: getVersion,
        staleTime: Infinity,
    });
    const paths = useQuery({ queryKey: ["app-paths"], queryFn: appPaths, staleTime: Infinity });

    return (
        <>
            <div className="flex flex-col gap-1.5">
                <span className="text-sm leading-none font-medium">{t.settings.version}</span>
                <span className="text-sm text-muted-foreground tabular-nums">
                    Strata {version.data ?? ""}
                </span>
            </div>
            {paths.data && (
                <>
                    <PathRow label={t.settings.dataDir} path={paths.data.dataDir} />
                    <PathRow
                        label={t.settings.logDir}
                        path={paths.data.logDir}
                        hint={t.settings.logHint}
                    />
                </>
            )}
        </>
    );
}
