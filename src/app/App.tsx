import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect } from "react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ConnectionDialog } from "@/features/connections/ConnectionDialog";
import { HostKeyDialog } from "@/features/connections/HostKeyDialog";
import { StructureDialog } from "@/features/structure/StructureDialog";
import { PasswordDialog } from "@/features/connections/PasswordDialog";
import { CommandPalette } from "@/features/palette/CommandPalette";
import { HistoryDialog } from "@/features/history/HistoryDialog";
import { SettingsDialog } from "@/features/settings/SettingsDialog";
import { useApplySettings, useResolvedTheme } from "@/features/settings/useThemeSync";
import { useWorkspaceStartup } from "@/features/workspace/persistence";
import { AppLayout } from "./AppLayout";
import { installBrowserGuards } from "./browserGuards";

const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            retry: 1,
            refetchOnWindowFocus: false,
        },
    },
});

export function App() {
    return (
        <QueryClientProvider client={queryClient}>
            <TooltipProvider delayDuration={300}>
                <AppShell />
            </TooltipProvider>
        </QueryClientProvider>
    );
}

function AppShell() {
    const theme = useResolvedTheme();
    useApplySettings();
    useEffect(() => (import.meta.env.PROD ? installBrowserGuards() : undefined), []);
    useWorkspaceStartup();

    return (
        <>
            <AppLayout />
            <ConnectionDialog />
            <PasswordDialog />
            <HostKeyDialog />
            <StructureDialog />
            <CommandPalette />
            <SettingsDialog />
            <HistoryDialog />
            <Toaster theme={theme} position="bottom-right" />
        </>
    );
}
