import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2Icon, Loader2Icon, PlugZapIcon, XCircleIcon } from "lucide-react";
import { useId, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { errorMessage } from "@/api/invoke";
import { saveProfile, testConnection } from "@/api/profiles";
import { useUiStore } from "@/app/uiStore";
import type { ConnectionProfile } from "@/bindings/ConnectionProfile";
import type { Engine } from "@/bindings/Engine";
import type { PasswordUpdate } from "@/bindings/PasswordUpdate";
import type { ProfileColor } from "@/bindings/ProfileColor";
import type { Safety } from "@/bindings/Safety";
import type { ServerDetails } from "@/bindings/ServerDetails";
import type { TlsMode } from "@/bindings/TlsMode";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { getT, useT } from "@/i18n";
import { cn } from "@/lib/utils";
import { groupNames } from "./groups";
import { COLOR_CLASSES, DEFAULT_PORTS, ENGINE_LABELS } from "./labels";
import { profilesKey, useProfiles } from "./useProfiles";

const ENGINES: Engine[] = ["mysql", "postgres"];
const TLS_MODES: TlsMode[] = ["disabled", "required", "verify_full"];
const SAFETIES: Safety[] = ["normal", "confirm", "read_only"];
const COLORS: ProfileColor[] = ["none", "red", "amber", "green", "sky", "violet"];

function emptyProfile(group: string | null): ConnectionProfile {
    return {
        id: "",
        name: "",
        engine: "mysql",
        host: "localhost",
        port: DEFAULT_PORTS.mysql,
        user: "root",
        database: null,
        tls: "disabled",
        color: "none",
        safety: "normal",
        askPassword: false,
        group,
    };
}

type TestState =
    | { status: "idle" }
    | { status: "running" }
    | { status: "ok"; details: ServerDetails }
    | { status: "error"; message: string };

export function ConnectionDialog() {
    const state = useUiStore((ui) => ui.connectionDialog);
    const close = () => useUiStore.getState().openConnectionDialog(null);
    const key = state ? (state.mode === "edit" ? state.profile.id : "new") : "closed";

    return (
        <Dialog open={state !== null} onOpenChange={(open) => !open && close()}>
            <DialogContent className="sm:max-w-xl">
                {state && (
                    <ConnectionForm
                        key={key}
                        initial={
                            state.mode === "edit"
                                ? state.profile
                                : emptyProfile(state.group ?? null)
                        }
                        editing={state.mode === "edit"}
                        onDone={close}
                    />
                )}
            </DialogContent>
        </Dialog>
    );
}

function ConnectionForm({
    initial,
    editing,
    onDone,
}: {
    initial: ConnectionProfile;
    editing: boolean;
    onDone: () => void;
}) {
    const t = useT();
    const text = t.connections.dialog;
    const id = useId();
    const queryClient = useQueryClient();
    const groups = groupNames(useProfiles().data ?? []);
    const [profile, setProfile] = useState(initial);
    const [password, setPassword] = useState("");
    const [passwordTouched, setPasswordTouched] = useState(false);
    const [test, setTest] = useState<TestState>({ status: "idle" });

    const update = <K extends keyof ConnectionProfile>(field: K, value: ConnectionProfile[K]) => {
        setProfile((current) => ({ ...current, [field]: value }));
        setTest({ status: "idle" });
    };

    const passwordUpdate = (): PasswordUpdate => {
        if (!passwordTouched) {
            return editing ? { mode: "keep" } : { mode: "clear" };
        }
        return password === "" ? { mode: "clear" } : { mode: "set", value: password };
    };

    const save = useMutation({
        mutationFn: () => saveProfile(profile, passwordUpdate()),
        onSuccess: async (saved) => {
            await queryClient.invalidateQueries({ queryKey: profilesKey });
            toast.success(getT().connections.toast.saved(saved.name));
            onDone();
        },
        onError: (error) =>
            toast.error(getT().connections.toast.saveFailed, { description: errorMessage(error) }),
    });

    const runTest = async () => {
        setTest({ status: "running" });
        try {
            const credentials = profile.askPassword
                ? ({ mode: "set", value: password } satisfies PasswordUpdate)
                : passwordUpdate();
            const details = await testConnection(profile, credentials);
            setTest({ status: "ok", details });
        } catch (error) {
            setTest({ status: "error", message: errorMessage(error) });
        }
    };

    const onEngineChange = (engine: Engine) => {
        setProfile((current) => ({
            ...current,
            engine,
            port:
                current.port === DEFAULT_PORTS[current.engine]
                    ? DEFAULT_PORTS[engine]
                    : current.port,
            user:
                current.user === (current.engine === "mysql" ? "root" : "postgres")
                    ? engine === "mysql"
                        ? "root"
                        : "postgres"
                    : current.user,
        }));
        setTest({ status: "idle" });
    };

    const onSubmit = (event: FormEvent) => {
        event.preventDefault();
        save.mutate();
    };

    const field = (name: string) => `${id}-${name}`;
    const canSave =
        profile.name.trim() !== "" &&
        profile.host.trim() !== "" &&
        profile.user.trim() !== "" &&
        profile.port > 0;

    return (
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
            <DialogHeader>
                <DialogTitle>{editing ? text.editTitle : text.newTitle}</DialogTitle>
                <DialogDescription>{text.description}</DialogDescription>
            </DialogHeader>

            <div className="grid grid-cols-6 gap-3">
                <div className="col-span-4 flex flex-col gap-1.5">
                    <Label htmlFor={field("name")}>{text.name}</Label>
                    <Input
                        id={field("name")}
                        autoFocus
                        required
                        maxLength={100}
                        placeholder={text.namePlaceholder}
                        value={profile.name}
                        onChange={(event) => update("name", event.target.value)}
                    />
                </div>
                <div className="col-span-2 flex flex-col gap-1.5">
                    <Label htmlFor={field("engine")}>{text.type}</Label>
                    <Select
                        value={profile.engine}
                        onValueChange={(value) => onEngineChange(value as Engine)}
                    >
                        <SelectTrigger id={field("engine")} className="w-full">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {ENGINES.map((engine) => (
                                <SelectItem key={engine} value={engine}>
                                    {ENGINE_LABELS[engine]}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>

                <div className="col-span-4 flex flex-col gap-1.5">
                    <Label htmlFor={field("host")}>{text.host}</Label>
                    <Input
                        id={field("host")}
                        required
                        spellCheck={false}
                        value={profile.host}
                        onChange={(event) => update("host", event.target.value)}
                    />
                </div>
                <div className="col-span-2 flex flex-col gap-1.5">
                    <Label htmlFor={field("port")}>{text.port}</Label>
                    <Input
                        id={field("port")}
                        required
                        inputMode="numeric"
                        value={profile.port === 0 ? "" : String(profile.port)}
                        onChange={(event) => {
                            const digits = event.target.value.replace(/\D/g, "").slice(0, 5);
                            update("port", Math.min(65535, Number(digits || "0")));
                        }}
                        className="tabular-nums"
                    />
                </div>

                <div className="col-span-3 flex flex-col gap-1.5">
                    <Label htmlFor={field("user")}>{text.user}</Label>
                    <Input
                        id={field("user")}
                        required
                        spellCheck={false}
                        autoComplete="off"
                        value={profile.user}
                        onChange={(event) => update("user", event.target.value)}
                    />
                </div>
                <div className="col-span-3 flex flex-col gap-1.5">
                    <Label htmlFor={field("password")}>{text.password}</Label>
                    <Input
                        id={field("password")}
                        type="password"
                        autoComplete="new-password"
                        placeholder={
                            profile.askPassword
                                ? text.passwordTestOnly
                                : editing
                                  ? text.passwordUnchanged
                                  : text.passwordNone
                        }
                        value={password}
                        onChange={(event) => {
                            setPassword(event.target.value);
                            setPasswordTouched(true);
                            setTest({ status: "idle" });
                        }}
                    />
                </div>

                <div className="col-span-6 flex items-center justify-between gap-3 rounded-lg border px-3 py-2">
                    <Label htmlFor={field("ask")} className="font-normal">
                        {text.askPassword}
                    </Label>
                    <Switch
                        id={field("ask")}
                        checked={profile.askPassword}
                        onCheckedChange={(checked) => update("askPassword", checked)}
                    />
                </div>

                <div className="col-span-3 flex flex-col gap-1.5">
                    <Label htmlFor={field("database")}>{text.database}</Label>
                    <Input
                        id={field("database")}
                        spellCheck={false}
                        placeholder={profile.engine === "postgres" ? "postgres" : text.databaseNone}
                        value={profile.database ?? ""}
                        onChange={(event) => update("database", event.target.value || null)}
                    />
                </div>
                <div className="col-span-3 flex flex-col gap-1.5">
                    <Label htmlFor={field("group")}>{text.group}</Label>
                    <Input
                        id={field("group")}
                        list={field("groups")}
                        maxLength={60}
                        placeholder={text.groupNone}
                        value={profile.group ?? ""}
                        onChange={(event) => update("group", event.target.value || null)}
                    />
                    <datalist id={field("groups")}>
                        {groups.map((group) => (
                            <option key={group} value={group} />
                        ))}
                    </datalist>
                </div>

                <div className="col-span-3 flex flex-col gap-1.5">
                    <Label htmlFor={field("tls")}>{text.tls}</Label>
                    <Select
                        value={profile.tls}
                        onValueChange={(value) => update("tls", value as TlsMode)}
                    >
                        <SelectTrigger id={field("tls")} className="w-full">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {TLS_MODES.map((mode) => (
                                <SelectItem key={mode} value={mode}>
                                    {t.connections.tls[mode]}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
                <div className="col-span-3 flex flex-col gap-1.5">
                    <Label htmlFor={field("safety")}>{text.safety}</Label>
                    <Select
                        value={profile.safety}
                        onValueChange={(value) => update("safety", value as Safety)}
                    >
                        <SelectTrigger id={field("safety")} className="w-full">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {SAFETIES.map((safety) => (
                                <SelectItem key={safety} value={safety}>
                                    {t.connections.safety[safety]}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>

                <fieldset className="col-span-6 flex flex-col gap-1.5">
                    <legend className="mb-1.5 text-sm leading-none font-medium">
                        {text.color}
                    </legend>
                    <div role="radiogroup" className="flex h-8 items-center gap-1.5">
                        {COLORS.map((color) => (
                            <button
                                key={color}
                                type="button"
                                role="radio"
                                aria-checked={profile.color === color}
                                aria-label={t.connections.colors[color]}
                                title={t.connections.colors[color]}
                                onClick={() => update("color", color)}
                                className={cn(
                                    "flex size-7 items-center justify-center rounded-full ring-offset-2 ring-offset-background transition-shadow outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none",
                                    profile.color === color && "ring-2 ring-primary",
                                )}
                            >
                                <span className={cn("size-4 rounded-full", COLOR_CLASSES[color])} />
                            </button>
                        ))}
                    </div>
                </fieldset>
            </div>

            <div aria-live="polite" className="min-h-5 text-sm">
                {test.status === "ok" && (
                    <p className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
                        <CheckCircle2Icon className="size-4" aria-hidden />
                        {text.testOk(test.details.flavor, test.details.version)}
                    </p>
                )}
                {test.status === "error" && (
                    <p className="flex items-start gap-2 text-destructive">
                        <XCircleIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
                        <span className="break-words select-text">{test.message}</span>
                    </p>
                )}
            </div>

            <DialogFooter className="sm:justify-between">
                <Button
                    type="button"
                    variant="outline"
                    disabled={!canSave || test.status === "running"}
                    onClick={() => void runTest()}
                >
                    {test.status === "running" ? (
                        <Loader2Icon className="animate-spin motion-reduce:animate-none" />
                    ) : (
                        <PlugZapIcon />
                    )}
                    {text.test}
                </Button>
                <div className="flex gap-2">
                    <Button type="button" variant="ghost" onClick={onDone}>
                        {t.common.cancel}
                    </Button>
                    <Button type="submit" disabled={!canSave || save.isPending}>
                        {save.isPending && (
                            <Loader2Icon className="animate-spin motion-reduce:animate-none" />
                        )}
                        {t.common.save}
                    </Button>
                </div>
            </DialogFooter>
        </form>
    );
}
