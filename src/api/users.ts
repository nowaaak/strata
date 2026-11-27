import type { UserAccount } from "@/bindings/UserAccount";
import type { UserAction } from "@/bindings/UserAction";
import type { UserDetail } from "@/bindings/UserDetail";
import type { UserRef } from "@/bindings/UserRef";
import { call } from "./invoke";

export const listUsers = (sessionId: string) => call<UserAccount[]>("list_users", { sessionId });

export const userDetail = (sessionId: string, user: UserRef) =>
    call<UserDetail>("user_detail", { sessionId, user });

export const previewUserAction = (sessionId: string, action: UserAction) =>
    call<string[]>("preview_user_action", { sessionId, action });

export const runUserAction = (sessionId: string, action: UserAction) =>
    call<string[]>("run_user_action", { sessionId, action });
