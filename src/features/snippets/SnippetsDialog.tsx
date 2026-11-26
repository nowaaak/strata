import { useMutation, useQueryClient } from "@tanstack/react-query";
import { PlusIcon, SearchIcon, Trash2Icon } from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";
import { errorMessage } from "@/api/invoke";
import { deleteSnippet, saveSnippet } from "@/api/snippets";
import { useUiStore } from "@/app/uiStore";
import type { Snippet } from "@/bindings/Snippet";
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
import { getT, useT } from "@/i18n";
import { cn } from "@/lib/utils";
import { editorText, insertSnippet } from "./insert";
import { snippetsKey, useSnippets } from "./useSnippets";

type Draft = { id: string | null; name: string; sql: string };

export function SnippetsDialog() {
    const state = useUiStore((ui) => ui.snippetsDialog);
    const close = () => useUiStore.getState().setSnippetsDialog(null);
    return (
        <Dialog open={state !== null} onOpenChange={(open) => !open && close()}>
            <DialogContent className="flex h-[min(640px,calc(100vh-4rem))] flex-col sm:max-w-4xl">
                {state && <SnippetsBody tabId={state.tabId} onDone={close} />}
            </DialogContent>
        </Dialog>
    );
}

function SnippetsBody({ tabId, onDone }: { tabId: string | null; onDone: () => void }) {
    const t = useT();
    const text = t.snippets;
    const id = useId();
    const queryClient = useQueryClient();
    const snippets = useSnippets();
    const [search, setSearch] = useState("");
    const [draft, setDraft] = useState<Draft | null>(null);

    const all = snippets.data ?? [];
    const needle = search.trim().toLowerCase();
    const visible = needle
        ? all.filter(
              (snippet) =>
                  snippet.name.toLowerCase().includes(needle) ||
                  snippet.sql.toLowerCase().includes(needle),
          )
        : all;
    const selected = draft ?? (visible[0] ? toDraft(visible[0]) : null);

    const save = useMutation({
        mutationFn: (value: Draft) => saveSnippet(value.id, value.name, value.sql),
        onSuccess: async (saved) => {
            await queryClient.invalidateQueries({ queryKey: snippetsKey });
            setDraft(toDraft(saved));
            toast.success(getT().snippets.saved(saved.name));
        },
        onError: (error) =>
            toast.error(getT().snippets.failed, { description: errorMessage(error) }),
    });
    const remove = useMutation({
        mutationFn: (snippet: Draft) => deleteSnippet(snippet.id ?? ""),
        onSuccess: async (_, snippet) => {
            await queryClient.invalidateQueries({ queryKey: snippetsKey });
            setDraft(null);
            toast.success(getT().snippets.deleted(snippet.name));
        },
        onError: (error) =>
            toast.error(getT().snippets.deleteFailed, { description: errorMessage(error) }),
    });

    const startNew = () => setDraft({ id: null, name: "", sql: editorText(tabId) });

    return (
        <>
            <DialogHeader>
                <DialogTitle>{text.title}</DialogTitle>
                <DialogDescription>{text.description}</DialogDescription>
            </DialogHeader>
            <div className="grid min-h-0 flex-1 gap-4 sm:grid-cols-[16rem_1fr]">
                <div className="flex min-h-0 flex-col gap-2">
                    <div className="relative">
                        <SearchIcon
                            aria-hidden
                            className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
                        />
                        <Input
                            aria-label={text.search}
                            placeholder={text.search}
                            value={search}
                            onChange={(event) => setSearch(event.target.value)}
                            className="h-8 pl-8 text-sm"
                        />
                    </div>
                    <Button variant="outline" size="sm" onClick={startNew}>
                        <PlusIcon />
                        {text.new}
                    </Button>
                    <ul
                        aria-label={text.title}
                        className="min-h-0 flex-1 overflow-auto rounded-lg border p-1"
                    >
                        {visible.map((snippet) => (
                            <li key={snippet.id}>
                                <button
                                    type="button"
                                    onClick={() => setDraft(toDraft(snippet))}
                                    onDoubleClick={() =>
                                        insertSnippet(tabId, snippet.sql) && onDone()
                                    }
                                    aria-current={selected?.id === snippet.id}
                                    className={cn(
                                        "flex w-full flex-col rounded-md px-2 py-1.5 text-left outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring",
                                        selected?.id === snippet.id && "bg-accent",
                                    )}
                                >
                                    <span className="truncate text-sm">{snippet.name}</span>
                                    <span className="truncate font-mono text-[11px] text-muted-foreground">
                                        {snippet.sql.replace(/\s+/g, " ")}
                                    </span>
                                </button>
                            </li>
                        ))}
                        {visible.length === 0 && (
                            <li className="px-2 py-6 text-center text-xs text-muted-foreground">
                                {needle ? text.noMatches : text.empty}
                            </li>
                        )}
                    </ul>
                </div>
                {selected ? (
                    <form
                        key={selected.id ?? "new"}
                        className="flex min-h-0 flex-col gap-3"
                        onSubmit={(event) => {
                            event.preventDefault();
                            save.mutate(selected);
                        }}
                    >
                        <div className="flex flex-col gap-1.5">
                            <Label htmlFor={`${id}-name`}>{text.name}</Label>
                            <Input
                                id={`${id}-name`}
                                autoFocus={selected.id === null}
                                maxLength={120}
                                placeholder={text.namePlaceholder}
                                value={selected.name}
                                onChange={(event) =>
                                    setDraft({ ...selected, name: event.target.value })
                                }
                            />
                        </div>
                        <div className="flex min-h-0 flex-1 flex-col gap-1.5">
                            <div className="flex items-center justify-between">
                                <Label htmlFor={`${id}-sql`}>{text.sql}</Label>
                                {tabId && (
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="xs"
                                        onClick={() =>
                                            setDraft({ ...selected, sql: editorText(tabId) })
                                        }
                                    >
                                        {text.fromEditor}
                                    </Button>
                                )}
                            </div>
                            <textarea
                                id={`${id}-sql`}
                                spellCheck={false}
                                value={selected.sql}
                                onChange={(event) =>
                                    setDraft({ ...selected, sql: event.target.value })
                                }
                                className="min-h-40 flex-1 resize-none rounded-lg border border-input bg-transparent p-3 font-mono text-[13px] outline-none focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
                            />
                        </div>
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            {selected.id ? (
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    className="text-destructive"
                                    disabled={remove.isPending}
                                    onClick={() => remove.mutate(selected)}
                                >
                                    <Trash2Icon />
                                    {text.delete}
                                </Button>
                            ) : (
                                <span />
                            )}
                            <div className="flex gap-2">
                                <Button
                                    type="submit"
                                    variant="outline"
                                    disabled={
                                        save.isPending ||
                                        selected.name.trim() === "" ||
                                        selected.sql.trim() === ""
                                    }
                                >
                                    {text.save}
                                </Button>
                                <Button
                                    type="button"
                                    disabled={selected.sql.trim() === ""}
                                    onClick={() => insertSnippet(tabId, selected.sql) && onDone()}
                                >
                                    {text.insert}
                                </Button>
                            </div>
                        </div>
                    </form>
                ) : (
                    <div className="flex items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
                        {text.empty}
                    </div>
                )}
            </div>
        </>
    );
}

function toDraft(snippet: Snippet): Draft {
    return { id: snippet.id, name: snippet.name, sql: snippet.sql };
}
