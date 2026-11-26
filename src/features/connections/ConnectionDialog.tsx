import { useMutation, useQueryClient } from "@tanstack/react-query";
import { open as openFileDialog, save as saveFileDialog } from "@tauri-apps/plugin-dialog";
import {
    CheckCircle2Icon,
    FilePlusIcon,
    FolderOpenIcon,
    Loader2Icon,
    PlugZapIcon,
    ShieldQuestionIcon,
    XCircleIcon,
} from "lucide-react";
import { useId, useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { AppError, errorMessage } from "@/api/invoke";
import { createSqliteFile, saveProfile, testConnection } from "@/api/profiles";
import { useUiStore } from "@/app/uiStore";
import type { ConnectionProfile } from "@/bindings/ConnectionProfile";
import type { Engine } from "@/bindings/Engine";
import type { PasswordUpdate } from "@/bindings/PasswordUpdate";
import type { ProfileColor } from "@/bindings/ProfileColor";
import type { Safety } from "@/bindings/Safety";
import type { ServerDetails } from "@/bindings/ServerDetails";
import type { SshAuth } from "@/bindings/SshAuth";
import type { SshConfig } from "@/bindings/SshConfig";
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

const ENGINES: Engine[] = ["mysql", "postgres", "sqlite"];
const SQLITE_FILTERS = [{ name: "SQLite", extensions: ["sqlite", "sqlite3", "db", "db3", "s3db"] }];
const DEFAULT_USERS: Record<Engine, string> = { mysql: "root", postgres: "postgres", sqlite: "" };
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
        ssh: null,
    };
}

const DEFAULT_SSH: SshConfig = {
    host: "",
    port: 22,
    user: "",
    auth: { kind: "password" },
    hostKey: null,
};

type TestState =
    | { status: "idle" }
    | { status: "running" }
    | { status: "ok"; details: ServerDetails }
    | { status: "error"; message: string }
    | { status: "unknown_host_key"; fingerprint: string };

export function ConnectionDialog() {
    const state = useUiStore((ui) => ui.connectionDialog);
    const close = () => useUiStore.getState().openConnectionDialog(null);
    const key = state ? (state.mode === "edit" ? state.profile.id : "new") : "closed";

    return (
        <Dialog open={state !== null} onOpenChange={(open) => !open && close()}>
            <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-xl">
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
    const [sshSecret, setSshSecret] = useState("");
    const [sshSecretTouched, setSshSecretTouched] = useState(false);
    const lastSsh = useRef<SshConfig>(initial.ssh ?? DEFAULT_SSH);
    const [test, setTest] = useState<TestState>({ status: "idle" });

    const update = <K extends keyof ConnectionProfile>(field: K, value: ConnectionProfile[K]) => {
        setProfile((current) => ({ ...current, [field]: value }));
        setTest({ status: "idle" });
    };

    const updateSsh = (patch: Partial<SshConfig>) => {
        setProfile((current) => {
            if (!current.ssh) {
                return current;
            }
            const next = { ...current.ssh, ...patch };
            const endpointChanged =
                next.host.trim() !== current.ssh.host.trim() || next.port !== current.ssh.port;
            if (endpointChanged && !("hostKey" in patch)) {
                next.hostKey = null;
            }
            lastSsh.current = next;
            return { ...current, ssh: next };
        });
        setTest({ status: "idle" });
    };

    const toggleSsh = (enabled: boolean) => {
        update("ssh", enabled ? lastSsh.current : null);
    };

    const passwordUpdate = (): PasswordUpdate => {
        if (!passwordTouched) {
            return editing ? { mode: "keep" } : { mode: "clear" };
        }
        return password === "" ? { mode: "clear" } : { mode: "set", value: password };
    };

    const sameAuthKind = editing && initial.ssh?.auth.kind === profile.ssh?.auth.kind;

    const sshSecretUpdate = (): PasswordUpdate => {
        if (!profile.ssh) {
            return { mode: "keep" };
        }
        if (!sshSecretTouched) {
            return sameAuthKind ? { mode: "keep" } : { mode: "clear" };
        }
        return sshSecret === "" ? { mode: "clear" } : { mode: "set", value: sshSecret };
    };

    const save = useMutation({
        mutationFn: () => saveProfile(profile, passwordUpdate(), sshSecretUpdate()),
        onSuccess: async (saved) => {
            await queryClient.invalidateQueries({ queryKey: profilesKey });
            toast.success(getT().connections.toast.saved(saved.name));
            onDone();
        },
        onError: (error) =>
            toast.error(getT().connections.toast.saveFailed, { description: errorMessage(error) }),
    });

    const runTest = async (target: ConnectionProfile = profile) => {
        setTest({ status: "running" });
        try {
            const credentials = target.askPassword
                ? ({ mode: "set", value: password } satisfies PasswordUpdate)
                : passwordUpdate();
            const details = await testConnection(target, credentials, sshSecretUpdate());
            setTest({ status: "ok", details });
        } catch (error) {
            if (
                error instanceof AppError &&
                error.kind === "ssh_host_key_unknown" &&
                error.detail
            ) {
                setTest({ status: "unknown_host_key", fingerprint: error.detail });
                return;
            }
            const message =
                error instanceof AppError && error.kind === "ssh_host_key_changed"
                    ? `${t.connections.ssh.changedTitle}. ${t.connections.ssh.changedDescription} ${t.connections.ssh.fingerprint}: ${error.detail ?? ""}`
                    : errorMessage(error);
            setTest({ status: "error", message });
        }
    };

    const trustAndRetest = (fingerprint: string) => {
        if (!profile.ssh) {
            return;
        }
        const ssh = { ...profile.ssh, hostKey: fingerprint };
        lastSsh.current = ssh;
        const next = { ...profile, ssh };
        setProfile(next);
        void runTest(next);
    };

    const chooseKeyFile = async () => {
        const path = await openFileDialog({ multiple: false, directory: false });
        if (typeof path === "string") {
            updateSsh({ auth: { kind: "key_file", path } });
        }
    };

    const onEngineChange = (engine: Engine) => {
        setProfile((current) => {
            const fromFile = current.engine === "sqlite";
            const toFile = engine === "sqlite";
            return {
                ...current,
                engine,
                host: fromFile !== toFile ? (toFile ? "" : "localhost") : current.host,
                port:
                    fromFile || current.port === DEFAULT_PORTS[current.engine]
                        ? DEFAULT_PORTS[engine]
                        : current.port,
                user:
                    fromFile || current.user === DEFAULT_USERS[current.engine]
                        ? DEFAULT_USERS[engine]
                        : current.user,
                ssh: toFile ? null : current.ssh,
                tls: toFile ? "disabled" : current.tls,
                askPassword: toFile ? false : current.askPassword,
                database: toFile ? null : current.database,
            };
        });
        setTest({ status: "idle" });
    };

    const chooseDatabaseFile = async () => {
        const path = await openFileDialog({
            multiple: false,
            directory: false,
            filters: [...SQLITE_FILTERS, { name: text.allFiles, extensions: ["*"] }],
        });
        if (typeof path === "string") {
            update("host", path);
        }
    };

    const createDatabaseFile = async () => {
        try {
            const path = await saveFileDialog({
                defaultPath: "neu.sqlite",
                filters: SQLITE_FILTERS,
            });
            if (!path) {
                return;
            }
            await createSqliteFile(path);
            update("host", path);
            if (profile.name.trim() === "") {
                update(
                    "name",
                    path
                        .split(/[\\/]/)
                        .pop()
                        ?.replace(/\.[^.]+$/, "") ?? "",
                );
            }
            toast.success(getT().connections.dialog.fileCreated);
        } catch (error) {
            toast.error(getT().connections.dialog.fileFailed, {
                description: errorMessage(error),
            });
        }
    };

    const onSubmit = (event: FormEvent) => {
        event.preventDefault();
        save.mutate();
    };

    const field = (name: string) => `${id}-${name}`;
    const sshComplete =
        profile.ssh === null ||
        (profile.ssh.host.trim() !== "" &&
            profile.ssh.user.trim() !== "" &&
            profile.ssh.port > 0 &&
            (profile.ssh.auth.kind === "password" || profile.ssh.auth.path.trim() !== ""));
    const sqlite = profile.engine === "sqlite";
    const canSave =
        profile.name.trim() !== "" &&
        profile.host.trim() !== "" &&
        (sqlite || (profile.user.trim() !== "" && profile.port > 0 && sshComplete));
    const ssh = profile.ssh;
    const sshText = t.connections.ssh;

    return (
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
            <DialogHeader>
                <DialogTitle>{editing ? text.editTitle : text.newTitle}</DialogTitle>
                <DialogDescription>
                    {sqlite ? text.descriptionSqlite : text.description}
                </DialogDescription>
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

                {sqlite ? (
                    <div className="col-span-6 flex flex-col gap-1.5">
                        <Label htmlFor={field("file")}>{text.file}</Label>
                        <div className="flex gap-2">
                            <Input
                                id={field("file")}
                                required
                                spellCheck={false}
                                placeholder={text.filePlaceholder}
                                value={profile.host}
                                onChange={(event) => update("host", event.target.value)}
                                className="font-mono text-xs"
                            />
                            <Button
                                type="button"
                                variant="outline"
                                onClick={() => void chooseDatabaseFile()}
                            >
                                <FolderOpenIcon />
                                {text.fileOpen}
                            </Button>
                            <Button
                                type="button"
                                variant="outline"
                                onClick={() => void createDatabaseFile()}
                            >
                                <FilePlusIcon />
                                {text.fileNew}
                            </Button>
                        </div>
                    </div>
                ) : (
                    <>
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
                                    const digits = event.target.value
                                        .replace(/\D/g, "")
                                        .slice(0, 5);
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
                    </>
                )}

                {!sqlite && (
                    <div className="col-span-3 flex flex-col gap-1.5">
                        <Label htmlFor={field("database")}>{text.database}</Label>
                        <Input
                            id={field("database")}
                            spellCheck={false}
                            placeholder={
                                profile.engine === "postgres" ? "postgres" : text.databaseNone
                            }
                            value={profile.database ?? ""}
                            onChange={(event) => update("database", event.target.value || null)}
                        />
                    </div>
                )}
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

                {!sqlite && (
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
                )}
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

                {!sqlite && (
                    <div className="col-span-6 flex flex-col gap-3 rounded-lg border px-3 py-2">
                        <div className="flex items-center justify-between gap-3">
                            <Label htmlFor={field("ssh")} className="font-normal">
                                {sshText.enable}
                            </Label>
                            <Switch
                                id={field("ssh")}
                                checked={ssh !== null}
                                onCheckedChange={toggleSsh}
                            />
                        </div>
                        {ssh && (
                            <div className="grid grid-cols-6 gap-3 pb-1">
                                <p className="col-span-6 text-xs text-muted-foreground">
                                    {sshText.hint}
                                </p>
                                <div className="col-span-4 flex flex-col gap-1.5">
                                    <Label htmlFor={field("ssh-host")}>{sshText.host}</Label>
                                    <Input
                                        id={field("ssh-host")}
                                        required
                                        spellCheck={false}
                                        value={ssh.host}
                                        onChange={(event) =>
                                            updateSsh({ host: event.target.value })
                                        }
                                    />
                                </div>
                                <div className="col-span-2 flex flex-col gap-1.5">
                                    <Label htmlFor={field("ssh-port")}>{sshText.port}</Label>
                                    <Input
                                        id={field("ssh-port")}
                                        required
                                        inputMode="numeric"
                                        value={ssh.port === 0 ? "" : String(ssh.port)}
                                        onChange={(event) => {
                                            const digits = event.target.value
                                                .replace(/\D/g, "")
                                                .slice(0, 5);
                                            updateSsh({
                                                port: Math.min(65535, Number(digits || "0")),
                                            });
                                        }}
                                        className="tabular-nums"
                                    />
                                </div>
                                <div className="col-span-3 flex flex-col gap-1.5">
                                    <Label htmlFor={field("ssh-user")}>{sshText.user}</Label>
                                    <Input
                                        id={field("ssh-user")}
                                        required
                                        spellCheck={false}
                                        autoComplete="off"
                                        value={ssh.user}
                                        onChange={(event) =>
                                            updateSsh({ user: event.target.value })
                                        }
                                    />
                                </div>
                                <div className="col-span-3 flex flex-col gap-1.5">
                                    <Label htmlFor={field("ssh-auth")}>{sshText.auth}</Label>
                                    <Select
                                        value={ssh.auth.kind}
                                        onValueChange={(kind) =>
                                            updateSsh({
                                                auth:
                                                    kind === "key_file"
                                                        ? { kind: "key_file", path: "" }
                                                        : ({ kind: "password" } satisfies SshAuth),
                                            })
                                        }
                                    >
                                        <SelectTrigger id={field("ssh-auth")} className="w-full">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="password">
                                                {sshText.authPassword}
                                            </SelectItem>
                                            <SelectItem value="key_file">
                                                {sshText.authKeyFile}
                                            </SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                                {ssh.auth.kind === "key_file" && (
                                    <div className="col-span-6 flex flex-col gap-1.5">
                                        <Label htmlFor={field("ssh-key")}>{sshText.keyFile}</Label>
                                        <div className="flex gap-2">
                                            <Input
                                                id={field("ssh-key")}
                                                required
                                                spellCheck={false}
                                                value={ssh.auth.path}
                                                onChange={(event) =>
                                                    updateSsh({
                                                        auth: {
                                                            kind: "key_file",
                                                            path: event.target.value,
                                                        },
                                                    })
                                                }
                                                className="font-mono text-xs"
                                            />
                                            <Button
                                                type="button"
                                                variant="outline"
                                                onClick={() => void chooseKeyFile()}
                                            >
                                                <FolderOpenIcon />
                                                {sshText.browse}
                                            </Button>
                                        </div>
                                    </div>
                                )}
                                <div className="col-span-6 flex flex-col gap-1.5">
                                    <Label htmlFor={field("ssh-secret")}>
                                        {ssh.auth.kind === "password"
                                            ? sshText.password
                                            : sshText.passphrase}
                                    </Label>
                                    <Input
                                        id={field("ssh-secret")}
                                        type="password"
                                        autoComplete="new-password"
                                        placeholder={
                                            sameAuthKind
                                                ? text.passwordUnchanged
                                                : ssh.auth.kind === "password"
                                                  ? text.passwordNone
                                                  : ""
                                        }
                                        value={sshSecret}
                                        onChange={(event) => {
                                            setSshSecret(event.target.value);
                                            setSshSecretTouched(true);
                                            setTest({ status: "idle" });
                                        }}
                                    />
                                </div>
                                <div className="col-span-6 flex flex-col gap-1.5">
                                    <span className="text-sm leading-none font-medium">
                                        {sshText.hostKey}
                                    </span>
                                    {ssh.hostKey ? (
                                        <div className="flex items-center gap-2">
                                            <code className="min-w-0 flex-1 truncate rounded-md bg-muted px-2 py-1.5 font-mono text-xs select-text">
                                                {ssh.hostKey}
                                            </code>
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => updateSsh({ hostKey: null })}
                                            >
                                                {sshText.forget}
                                            </Button>
                                        </div>
                                    ) : (
                                        <p className="text-xs text-muted-foreground">
                                            {sshText.hostKeyNone}
                                        </p>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                )}
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
                {test.status === "unknown_host_key" && (
                    <div className="flex flex-col gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
                        <p className="flex items-center gap-2 font-medium">
                            <ShieldQuestionIcon className="size-4 text-amber-500" aria-hidden />
                            {sshText.unknownTitle}
                        </p>
                        <p className="text-muted-foreground">
                            {sshText.unknownDescription(ssh ? `${ssh.host}:${ssh.port}` : "")}
                        </p>
                        <code className="rounded-md bg-muted px-2 py-1.5 font-mono text-xs break-all select-text">
                            {test.fingerprint}
                        </code>
                        <Button
                            type="button"
                            size="sm"
                            className="self-start"
                            onClick={() => trustAndRetest(test.fingerprint)}
                        >
                            {sshText.trustTest}
                        </Button>
                    </div>
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
