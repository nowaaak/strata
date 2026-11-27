import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
    KeyRoundIcon,
    Loader2Icon,
    LockIcon,
    PlusIcon,
    SearchIcon,
    ShieldAlertIcon,
    Trash2Icon,
    UnlockIcon,
    UserIcon,
    UsersIcon,
    XIcon,
} from "lucide-react";
import { useId, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { errorMessage } from "@/api/invoke";
import { listDatabases, listObjects, listSchemas } from "@/api/schema";
import { listUsers, previewUserAction, runUserAction, userDetail } from "@/api/users";
import { useUiStore } from "@/app/uiStore";
import type { RoleAttribute } from "@/bindings/RoleAttribute";
import type { SessionInfo } from "@/bindings/SessionInfo";
import type { UserAccount } from "@/bindings/UserAccount";
import type { UserAction } from "@/bindings/UserAction";
import type { UserRef } from "@/bindings/UserRef";
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
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
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
import { useProfile } from "@/features/connections/useProfiles";
import { useWorkspace } from "@/features/workspace/workspaceStore";
import { getT, useT } from "@/i18n";
import { cn } from "@/lib/utils";
import {
    ALL_PRIVILEGES,
    accountKey,
    accountLabel,
    buildScope,
    filterAccounts,
    privilegeChoices,
    refOf,
    scopeKinds,
    scopeObject,
    type ScopeKind,
} from "./privileges";

const PG_ATTRIBUTES: RoleAttribute[] = ["superuser", "create_db", "create_role", "replication"];
const CHECKBOX = "size-4 cursor-pointer accent-[var(--primary)] disabled:cursor-not-allowed";

type Propose = (action: UserAction, destructive?: boolean) => void;
type Pending = { action: UserAction; statements: string[]; destructive: boolean } | null;

export function UsersDialog() {
    const sessionId = useUiStore((ui) => ui.usersSession);
    const session = useWorkspace((state) => (sessionId ? state.sessions[sessionId] : undefined));
    const close = () => useUiStore.getState().setUsersSession(null);
    return (
        <Dialog open={session !== undefined} onOpenChange={(open) => !open && close()}>
            <DialogContent className="flex h-[calc(100vh-4rem)] flex-col sm:max-w-6xl">
                {session && <UsersBody key={session.sessionId} session={session} />}
            </DialogContent>
        </Dialog>
    );
}

function UsersBody({ session }: { session: SessionInfo }) {
    const t = useT();
    const text = t.users;
    const queryClient = useQueryClient();
    const profile = useProfile(session.profileId);
    const sessionId = session.sessionId;
    const readOnly = session.readOnly;
    const [selected, setSelected] = useState<string | null>(null);
    const [search, setSearch] = useState("");
    const [pending, setPending] = useState<Pending>(null);

    const users = useQuery({
        queryKey: ["users", sessionId],
        queryFn: () => listUsers(sessionId),
        retry: false,
    });
    const accounts = users.data ?? [];
    const shown = filterAccounts(accounts, search);
    const current = accounts.find((account) => accountKey(refOf(account)) === selected) ?? null;

    const propose: Propose = (action, destructive = false) => {
        previewUserAction(sessionId, action)
            .then((statements) => setPending({ action, statements, destructive }))
            .catch((error: unknown) =>
                toast.error(getT().users.failed, { description: errorMessage(error) }),
            );
    };

    const run = useMutation({
        mutationFn: (action: UserAction) => runUserAction(sessionId, action),
        onSuccess: async (_, action) => {
            toast.success(getT().users.done);
            setPending(null);
            if (action.action === "drop") {
                setSelected(null);
            }
            if (action.action === "create") {
                setSelected(accountKey(action.user));
            }
            await queryClient.invalidateQueries({ queryKey: ["users", sessionId] });
            await queryClient.invalidateQueries({ queryKey: ["user-detail", sessionId] });
        },
        onError: (error) => toast.error(getT().users.failed, { description: errorMessage(error) }),
    });

    return (
        <>
            <DialogHeader>
                <DialogTitle>{text.title(profile?.name ?? "")}</DialogTitle>
                <DialogDescription>{text.description}</DialogDescription>
            </DialogHeader>
            {readOnly && (
                <p className="flex items-center gap-2 rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                    <ShieldAlertIcon className="size-3.5 shrink-0" aria-hidden />
                    {text.readOnly}
                </p>
            )}
            <div className="grid min-h-0 flex-1 grid-cols-[17rem_1fr] gap-4">
                <div className="flex min-h-0 flex-col gap-2">
                    <div className="relative">
                        <SearchIcon
                            className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
                            aria-hidden
                        />
                        <Input
                            value={search}
                            onChange={(event) => setSearch(event.target.value)}
                            placeholder={text.search}
                            aria-label={text.search}
                            className="h-8 pl-8"
                        />
                    </div>
                    <Button
                        size="sm"
                        variant="outline"
                        disabled={readOnly}
                        onClick={() => setSelected("new")}
                    >
                        <PlusIcon />
                        {session.engine === "postgres" ? text.newRole : text.newUser}
                    </Button>
                    <ul
                        aria-label={text.search}
                        className="min-h-0 flex-1 overflow-auto rounded-lg border p-1"
                    >
                        {users.isPending && (
                            <li className="flex items-center gap-2 p-3 text-sm text-muted-foreground">
                                <Loader2Icon className="size-4 animate-spin motion-reduce:animate-none" />
                                {text.loading}
                            </li>
                        )}
                        {users.isError && (
                            <li className="p-3 text-sm text-destructive select-text">
                                {text.loadFailed}: {errorMessage(users.error)}
                            </li>
                        )}
                        {users.isSuccess && shown.length === 0 && (
                            <li className="p-3 text-sm text-muted-foreground">{text.empty}</li>
                        )}
                        {shown.map((account) => {
                            const key = accountKey(refOf(account));
                            const Icon = account.canLogin ? UserIcon : UsersIcon;
                            return (
                                <li key={key}>
                                    <button
                                        type="button"
                                        aria-current={selected === key}
                                        onClick={() => setSelected(key)}
                                        className={cn(
                                            "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring",
                                            selected === key && "bg-accent",
                                        )}
                                    >
                                        <Icon
                                            className="size-3.5 shrink-0 text-muted-foreground"
                                            aria-hidden
                                        />
                                        <span className="min-w-0 flex-1 truncate font-mono text-xs">
                                            {account.name}
                                            {account.host !== null && (
                                                <span className="text-muted-foreground">
                                                    @{account.host}
                                                </span>
                                            )}
                                        </span>
                                        <AccountBadges account={account} engine={session.engine} />
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                </div>
                <div className="min-h-0 overflow-auto pr-1">
                    {selected === "new" ? (
                        <CreateForm
                            engine={session.engine}
                            onSubmit={(action) => propose(action)}
                        />
                    ) : current ? (
                        <UserPanel
                            key={accountKey(refOf(current))}
                            session={session}
                            account={current}
                            accounts={accounts}
                            readOnly={readOnly}
                            propose={propose}
                        />
                    ) : (
                        <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
                            {text.pick}
                        </p>
                    )}
                </div>
            </div>

            <AlertDialog
                open={pending !== null}
                onOpenChange={(open) => !open && !run.isPending && setPending(null)}
            >
                <AlertDialogContent className="sm:max-w-xl">
                    {pending && (
                        <>
                            <AlertDialogHeader>
                                <AlertDialogTitle>{text.confirm.title}</AlertDialogTitle>
                                <AlertDialogDescription asChild>
                                    <pre className="max-h-64 overflow-auto rounded-md bg-muted p-3 font-mono text-xs whitespace-pre-wrap text-foreground select-text">
                                        {pending.statements.join(";\n")};
                                    </pre>
                                </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                                <AlertDialogCancel disabled={run.isPending}>
                                    {t.common.cancel}
                                </AlertDialogCancel>
                                <AlertDialogAction
                                    variant={pending.destructive ? "destructive" : "default"}
                                    disabled={run.isPending}
                                    onClick={(event) => {
                                        event.preventDefault();
                                        run.mutate(pending.action);
                                    }}
                                >
                                    {run.isPending && (
                                        <Loader2Icon className="animate-spin motion-reduce:animate-none" />
                                    )}
                                    {text.confirm.run}
                                </AlertDialogAction>
                            </AlertDialogFooter>
                        </>
                    )}
                </AlertDialogContent>
            </AlertDialog>
        </>
    );
}

function AccountBadges({ account, engine }: { account: UserAccount; engine: string }) {
    const text = useT().users.badges;
    return (
        <span className="flex shrink-0 gap-1">
            {account.superuser && (
                <span className="rounded bg-primary/15 px-1 py-0.5 text-[0.6875rem] font-medium text-primary">
                    {text.superuser}
                </span>
            )}
            {!account.canLogin && (
                <span className="rounded bg-muted px-1 py-0.5 text-[0.6875rem] text-muted-foreground">
                    {engine === "postgres" ? text.noLogin : text.locked}
                </span>
            )}
        </span>
    );
}

function CreateForm({
    engine,
    onSubmit,
}: {
    engine: string;
    onSubmit: (action: UserAction) => void;
}) {
    const text = useT().users.create;
    const id = useId();
    const mysql = engine !== "postgres";
    const [name, setName] = useState("");
    const [host, setHost] = useState("%");
    const [password, setPassword] = useState("");
    const [canLogin, setCanLogin] = useState(true);

    const submit = (event: FormEvent) => {
        event.preventDefault();
        onSubmit({
            action: "create",
            user: { name: name.trim(), host: mysql ? host.trim() || "%" : null },
            password: password === "" ? null : password,
            can_login: canLogin,
        });
    };

    return (
        <form onSubmit={submit} className="flex max-w-md flex-col gap-3">
            <h3 className="text-sm font-medium">{text.title}</h3>
            <div className="flex flex-col gap-1.5">
                <Label htmlFor={`${id}-name`}>{text.name}</Label>
                <Input
                    id={`${id}-name`}
                    autoFocus
                    required
                    spellCheck={false}
                    autoComplete="off"
                    maxLength={128}
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    className="font-mono"
                />
            </div>
            {mysql && (
                <div className="flex flex-col gap-1.5">
                    <Label htmlFor={`${id}-host`}>{text.host}</Label>
                    <Input
                        id={`${id}-host`}
                        spellCheck={false}
                        autoComplete="off"
                        maxLength={128}
                        value={host}
                        onChange={(event) => setHost(event.target.value)}
                        className="font-mono"
                    />
                    <span className="text-xs text-muted-foreground">{text.hostHint}</span>
                </div>
            )}
            <div className="flex flex-col gap-1.5">
                <Label htmlFor={`${id}-password`}>{text.password}</Label>
                <Input
                    id={`${id}-password`}
                    type="password"
                    autoComplete="new-password"
                    placeholder={text.passwordNone}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                />
            </div>
            <div className="flex items-start gap-2">
                <Switch id={`${id}-login`} checked={canLogin} onCheckedChange={setCanLogin} />
                <div className="flex flex-col gap-0.5">
                    <Label htmlFor={`${id}-login`} className="font-normal">
                        {text.canLogin}
                    </Label>
                    {!mysql && (
                        <span className="text-xs text-muted-foreground">{text.canLoginHint}</span>
                    )}
                </div>
            </div>
            <Button type="submit" className="self-start" disabled={name.trim() === ""}>
                {text.submit}
            </Button>
        </form>
    );
}

function UserPanel({
    session,
    account,
    accounts,
    readOnly,
    propose,
}: {
    session: SessionInfo;
    account: UserAccount;
    accounts: UserAccount[];
    readOnly: boolean;
    propose: Propose;
}) {
    const t = useT();
    const text = t.users;
    const id = useId();
    const postgres = session.engine === "postgres";
    const user = refOf(account);
    const [password, setPassword] = useState("");

    const detail = useQuery({
        queryKey: ["user-detail", session.sessionId, accountKey(user)],
        queryFn: () => userDetail(session.sessionId, user),
        retry: false,
    });
    const grants = detail.data?.grants ?? [];
    const roles = accounts
        .map((candidate) => candidate.name)
        .filter((name) => name !== account.name && !account.memberOf.includes(name));
    const attributeOn = (attribute: RoleAttribute) =>
        attribute === "superuser" ? account.superuser : account.attributes.includes(attribute);

    return (
        <div className="flex flex-col gap-5">
            <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-mono text-base font-medium">{accountLabel(user)}</h3>
                <AccountBadges account={account} engine={session.engine} />
                {account.validUntil && (
                    <span className="text-xs text-muted-foreground">{account.validUntil}</span>
                )}
                <span className="ml-auto flex gap-2">
                    <Button
                        size="sm"
                        variant="outline"
                        disabled={readOnly}
                        onClick={() =>
                            propose({ action: "set_login", user, enabled: !account.canLogin })
                        }
                    >
                        {account.canLogin ? <LockIcon /> : <UnlockIcon />}
                        {postgres
                            ? account.canLogin
                                ? text.actions.denyLogin
                                : text.actions.allowLogin
                            : account.canLogin
                              ? text.actions.lock
                              : text.actions.unlock}
                    </Button>
                    <Button
                        size="sm"
                        variant="outline"
                        className="text-destructive"
                        disabled={readOnly}
                        onClick={() => propose({ action: "drop", user }, true)}
                    >
                        <Trash2Icon />
                        {text.actions.drop}
                    </Button>
                </span>
            </div>

            <form
                className="flex flex-wrap items-end gap-2"
                onSubmit={(event) => {
                    event.preventDefault();
                    propose({ action: "set_password", user, password });
                    setPassword("");
                }}
            >
                <div className="flex flex-col gap-1.5">
                    <Label htmlFor={`${id}-password`} className="text-xs">
                        {text.actions.password}
                    </Label>
                    <Input
                        id={`${id}-password`}
                        type="password"
                        autoComplete="new-password"
                        placeholder={text.actions.newPassword}
                        disabled={readOnly}
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        className="h-8 w-64"
                    />
                </div>
                <Button
                    type="submit"
                    size="sm"
                    variant="outline"
                    disabled={readOnly || password === ""}
                >
                    <KeyRoundIcon />
                    {text.actions.setPassword}
                </Button>
            </form>

            {postgres && (
                <section className="flex flex-col gap-2">
                    <h4 className="text-sm font-medium">{text.attributes}</h4>
                    <div className="grid gap-2 sm:grid-cols-2">
                        {PG_ATTRIBUTES.map((attribute) => (
                            <div key={attribute} className="flex items-center gap-2">
                                <Switch
                                    id={`${id}-${attribute}`}
                                    checked={attributeOn(attribute)}
                                    disabled={readOnly}
                                    onCheckedChange={(enabled) =>
                                        propose({
                                            action: "set_attribute",
                                            user,
                                            attribute,
                                            enabled,
                                        })
                                    }
                                />
                                <Label htmlFor={`${id}-${attribute}`} className="font-normal">
                                    {text.attribute[attribute]}
                                </Label>
                            </div>
                        ))}
                    </div>
                </section>
            )}

            {postgres && (
                <section className="flex flex-col gap-2">
                    <h4 className="text-sm font-medium">{text.membership}</h4>
                    <div className="flex flex-wrap items-center gap-1.5">
                        {account.memberOf.length === 0 && (
                            <span className="text-xs text-muted-foreground">
                                {text.membershipNone}
                            </span>
                        )}
                        {account.memberOf.map((role) => (
                            <span
                                key={role}
                                className="flex items-center gap-1 rounded-md border py-0.5 pr-0.5 pl-2 font-mono text-xs"
                            >
                                {role}
                                <Button
                                    size="icon"
                                    variant="ghost"
                                    className="size-5"
                                    disabled={readOnly}
                                    aria-label={text.removeMembership(role)}
                                    title={text.removeMembership(role)}
                                    onClick={() =>
                                        propose({ action: "remove_member", user, role }, true)
                                    }
                                >
                                    <XIcon className="size-3" />
                                </Button>
                            </span>
                        ))}
                        {!readOnly && roles.length > 0 && (
                            <Select
                                value=""
                                onValueChange={(role) =>
                                    propose({ action: "add_member", user, role })
                                }
                            >
                                <SelectTrigger
                                    size="sm"
                                    aria-label={text.addMembership}
                                    className="h-7 w-44 text-xs"
                                >
                                    <SelectValue placeholder={text.addMembership} />
                                </SelectTrigger>
                                <SelectContent>
                                    {roles.map((role) => (
                                        <SelectItem
                                            key={role}
                                            value={role}
                                            className="font-mono text-xs"
                                        >
                                            {role}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        )}
                    </div>
                </section>
            )}

            <section className="flex flex-col gap-2">
                <h4 className="text-sm font-medium">{text.grants}</h4>
                {postgres && session.server.database && (
                    <p className="text-xs text-muted-foreground">
                        {text.grantsPgHint(session.server.database)}
                    </p>
                )}
                {detail.isPending && (
                    <p className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Loader2Icon className="size-4 animate-spin motion-reduce:animate-none" />
                        {text.loading}
                    </p>
                )}
                {detail.isError && (
                    <p className="text-sm text-destructive select-text">
                        {text.loadFailed}: {errorMessage(detail.error)}
                    </p>
                )}
                {detail.isSuccess && grants.length === 0 && (
                    <p className="text-sm text-muted-foreground">{text.grantsNone}</p>
                )}
                {grants.length > 0 && (
                    <div className="overflow-auto rounded-lg border">
                        <table className="w-full border-collapse text-left text-[13px]">
                            <thead className="bg-muted text-xs text-muted-foreground">
                                <tr>
                                    <th className="px-3 py-2 font-medium">{text.columns.scope}</th>
                                    <th className="px-3 py-2 font-medium">{text.columns.object}</th>
                                    <th className="px-3 py-2 font-medium">
                                        {text.columns.privileges}
                                    </th>
                                    <th className="w-10 px-2 py-2" />
                                </tr>
                            </thead>
                            <tbody>
                                {grants.map((grant) => {
                                    const object = scopeObject(grant.scope);
                                    return (
                                        <tr
                                            key={`${JSON.stringify(grant.scope)}-${grant.grantable}`}
                                            className="border-t align-top"
                                        >
                                            <td className="px-3 py-1.5 whitespace-nowrap">
                                                {text.scope[grant.scope.kind]}
                                            </td>
                                            <td className="px-3 py-1.5 font-mono text-xs">
                                                {object}
                                            </td>
                                            <td className="px-3 py-1.5 font-mono text-xs">
                                                {grant.privileges.join(", ")}
                                                {grant.grantable && (
                                                    <span className="ml-2 rounded bg-muted px-1 py-0.5 font-sans text-[0.6875rem] text-muted-foreground">
                                                        {text.columns.grantable}
                                                    </span>
                                                )}
                                            </td>
                                            <td className="px-2 py-1 text-right">
                                                <Button
                                                    size="icon"
                                                    variant="ghost"
                                                    className="size-7"
                                                    disabled={readOnly}
                                                    aria-label={text.revoke(object)}
                                                    title={text.revoke(object)}
                                                    onClick={() =>
                                                        propose(
                                                            {
                                                                action: "revoke",
                                                                user,
                                                                scope: grant.scope,
                                                                privileges: grant.privileges,
                                                            },
                                                            true,
                                                        )
                                                    }
                                                >
                                                    <Trash2Icon />
                                                </Button>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </section>

            {!readOnly && <GrantForm session={session} user={user} propose={propose} />}

            {detail.data && detail.data.statements.length > 0 && (
                <section className="flex flex-col gap-2">
                    <h4 className="text-sm font-medium">{text.statements}</h4>
                    <pre className="overflow-auto rounded-md bg-muted p-3 font-mono text-xs whitespace-pre-wrap select-text">
                        {detail.data.statements.join(";\n")};
                    </pre>
                </section>
            )}
        </div>
    );
}

function GrantForm({
    session,
    user,
    propose,
}: {
    session: SessionInfo;
    user: UserRef;
    propose: Propose;
}) {
    const t = useT();
    const text = t.users.grant;
    const id = useId();
    const engine = session.engine;
    const postgres = engine === "postgres";
    const kinds = scopeKinds(engine);
    const currentDatabase = session.server.database ?? "";
    const [kind, setKind] = useState<ScopeKind>(kinds[1] ?? "database");
    const [database, setDatabase] = useState(postgres ? currentDatabase : "");
    const [schema, setSchema] = useState(postgres ? "public" : "");
    const [table, setTable] = useState("");
    const [picked, setPicked] = useState<string[]>([]);
    const [all, setAll] = useState(false);
    const [option, setOption] = useState(false);

    const needsDatabase = kind === "database" || (!postgres && kind === "table");
    const needsSchema = postgres && kind !== "database";
    const needsTable = kind === "table";
    const tableDatabase = postgres ? currentDatabase : database;

    const databases = useQuery({
        queryKey: ["databases", session.sessionId],
        queryFn: () => listDatabases(session.sessionId),
        enabled: needsDatabase,
        staleTime: 60_000,
    });
    const schemas = useQuery({
        queryKey: ["schemas", session.sessionId, currentDatabase],
        queryFn: () => listSchemas(session.sessionId, currentDatabase),
        enabled: needsSchema,
        staleTime: 60_000,
    });
    const tables = useQuery({
        queryKey: ["objects", session.sessionId, tableDatabase, postgres ? schema : null],
        queryFn: () => listObjects(session.sessionId, tableDatabase, postgres ? schema : null),
        enabled: needsTable && tableDatabase !== "",
        staleTime: 60_000,
    });

    const scope = buildScope(
        kind,
        postgres && kind === "table" ? currentDatabase : database,
        needsSchema ? schema : "",
        table,
    );
    const privileges = all ? [ALL_PRIVILEGES] : picked;
    const choices = privilegeChoices(engine, kind);

    const changeKind = (next: ScopeKind) => {
        setKind(next);
        setPicked([]);
        setAll(false);
        setTable("");
    };

    const picker = (
        label: string,
        value: string,
        options: string[],
        onChange: (value: string) => void,
    ) => (
        <div className="flex flex-col gap-1.5">
            <span className="text-xs">{label}</span>
            <Select value={value} onValueChange={onChange}>
                <SelectTrigger size="sm" aria-label={label} className="h-8 w-48 font-mono text-xs">
                    <SelectValue placeholder={text.pick} />
                </SelectTrigger>
                <SelectContent>
                    {options.map((option) => (
                        <SelectItem key={option} value={option} className="font-mono text-xs">
                            {option}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
        </div>
    );

    return (
        <section className="flex flex-col gap-3 rounded-lg border border-dashed p-3">
            <h4 className="text-sm font-medium">{text.title}</h4>
            <div className="flex flex-wrap items-end gap-3">
                <div className="flex flex-col gap-1.5">
                    <span className="text-xs">{text.scope}</span>
                    <Select value={kind} onValueChange={(value) => changeKind(value as ScopeKind)}>
                        <SelectTrigger size="sm" aria-label={text.scope} className="h-8 w-56">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {kinds.map((entry) => (
                                <SelectItem key={entry} value={entry}>
                                    {t.users.scope[entry]}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
                {needsDatabase &&
                    picker(text.database, database, databases.data ?? [], (value) => {
                        setDatabase(value);
                        setTable("");
                    })}
                {needsSchema &&
                    picker(text.schema, schema, schemas.data ?? [], (value) => {
                        setSchema(value);
                        setTable("");
                    })}
                {needsTable &&
                    picker(
                        text.table,
                        table,
                        (tables.data ?? []).map((object) => object.name),
                        setTable,
                    )}
            </div>
            <div className="flex flex-col gap-2">
                <label className="flex items-center gap-2 text-[13px]">
                    <input
                        type="checkbox"
                        className={CHECKBOX}
                        checked={all}
                        onChange={(event) => setAll(event.target.checked)}
                    />
                    {text.all}
                </label>
                <div
                    role="group"
                    aria-label={t.users.columns.privileges}
                    className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3"
                >
                    {choices.map((privilege) => (
                        <label
                            key={privilege}
                            className={cn(
                                "flex items-center gap-2 font-mono text-xs",
                                all && "opacity-50",
                            )}
                        >
                            <input
                                type="checkbox"
                                className={CHECKBOX}
                                disabled={all}
                                checked={picked.includes(privilege)}
                                onChange={(event) =>
                                    setPicked((current) =>
                                        event.target.checked
                                            ? [...current, privilege]
                                            : current.filter((entry) => entry !== privilege),
                                    )
                                }
                            />
                            {privilege}
                        </label>
                    ))}
                </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                    <Switch id={`${id}-option`} checked={option} onCheckedChange={setOption} />
                    <Label htmlFor={`${id}-option`} className="font-normal">
                        {text.option}
                    </Label>
                </div>
                <Button
                    size="sm"
                    disabled={scope === null || privileges.length === 0}
                    onClick={() =>
                        scope &&
                        propose({
                            action: "grant",
                            user,
                            scope,
                            privileges,
                            grant_option: option,
                        })
                    }
                >
                    {text.submit}
                </Button>
            </div>
        </section>
    );
}
