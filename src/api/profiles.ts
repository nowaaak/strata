import type { ConnectionProfile } from "@/bindings/ConnectionProfile";
import type { PasswordUpdate } from "@/bindings/PasswordUpdate";
import type { ServerDetails } from "@/bindings/ServerDetails";
import { call } from "./invoke";

export const listProfiles = () => call<ConnectionProfile[]>("list_profiles");

export const saveProfile = (
    profile: ConnectionProfile,
    password: PasswordUpdate,
    sshSecret: PasswordUpdate = { mode: "keep" },
) => call<ConnectionProfile>("save_profile", { profile, password, sshSecret });

export const deleteProfile = (id: string) => call<void>("delete_profile", { id });

export const testConnection = (
    profile: ConnectionProfile,
    password: PasswordUpdate,
    sshSecret: PasswordUpdate = { mode: "keep" },
) => call<ServerDetails>("test_connection", { profile, password, sshSecret });

export const setProfileGroup = (id: string, group: string | null) =>
    call<ConnectionProfile>("set_profile_group", { id, group });

export const renameGroup = (from: string, to: string | null) =>
    call<number>("rename_group", { from, to });

export const setSshHostKey = (id: string, fingerprint: string | null) =>
    call<ConnectionProfile>("set_ssh_host_key", { id, fingerprint });

export const createSqliteFile = (path: string) => call<void>("create_sqlite_file", { path });
