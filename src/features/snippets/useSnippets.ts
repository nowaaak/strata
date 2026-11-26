import { useQuery } from "@tanstack/react-query";
import { listSnippets } from "@/api/snippets";

export const snippetsKey = ["snippets"] as const;

export function useSnippets() {
    return useQuery({ queryKey: snippetsKey, queryFn: listSnippets, staleTime: Infinity });
}
