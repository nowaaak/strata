import type { Snippet } from "@/bindings/Snippet";
import { call } from "./invoke";

export const listSnippets = () => call<Snippet[]>("list_snippets");

export const saveSnippet = (id: string | null, name: string, sql: string) =>
    call<Snippet>("save_snippet", { id, name, sql });

export const deleteSnippet = (id: string) => call<void>("delete_snippet", { id });
