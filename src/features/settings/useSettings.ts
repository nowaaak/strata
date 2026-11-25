import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { errorMessage } from "@/api/invoke";
import { getSettings, updateSettings } from "@/api/settings";
import type { Settings } from "@/bindings/Settings";
import { getT } from "@/i18n";

export const settingsKey = ["settings"] as const;

export function useSettings() {
    return useQuery({ queryKey: settingsKey, queryFn: getSettings, staleTime: Infinity });
}

export function useUpdateSettings() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: updateSettings,
        onMutate: async (next: Settings) => {
            await queryClient.cancelQueries({ queryKey: settingsKey });
            const previous = queryClient.getQueryData<Settings>(settingsKey);
            queryClient.setQueryData(settingsKey, next);
            return { previous };
        },
        onError: (error, _next, context) => {
            if (context?.previous) {
                queryClient.setQueryData(settingsKey, context.previous);
            }
            toast.error(getT().settings.saveFailed, { description: errorMessage(error) });
        },
        onSuccess: (saved) => queryClient.setQueryData(settingsKey, saved),
    });
}
