import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { lazy, useEffect } from "react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ConnectionDialog } from "@/features/connections/ConnectionDialog";
import { HostKeyDialog } from "@/features/connections/HostKeyDialog";
import { PasswordDialog } from "@/features/connections/PasswordDialog";
import { CommandPalette } from "@/features/palette/CommandPalette";
import { useApplySettings, useResolvedTheme } from "@/features/settings/useThemeSync";
import { useWorkspaceStartup } from "@/features/workspace/persistence";
import { AppLayout } from "./AppLayout";
import { installBrowserGuards } from "./browserGuards";
import { OnDemand } from "./OnDemand";

const StructureDialog = lazy(() =>
    import("@/features/structure/StructureDialog").then((module) => ({
        default: module.StructureDialog,
    })),
);
const ProcessDialog = lazy(() =>
    import("@/features/processes/ProcessDialog").then((module) => ({
        default: module.ProcessDialog,
    })),
);
const TableDesigner = lazy(() =>
    import("@/features/designer/TableDesigner").then((module) => ({
        default: module.TableDesigner,
    })),
);
const ImportDialog = lazy(() =>
    import("@/features/importer/ImportDialog").then((module) => ({ default: module.ImportDialog })),
);
const SnippetsDialog = lazy(() =>
    import("@/features/snippets/SnippetsDialog").then((module) => ({
        default: module.SnippetsDialog,
    })),
);
const ExplainDialog = lazy(() =>
    import("@/features/explain/ExplainDialog").then((module) => ({
        default: module.ExplainDialog,
    })),
);
const ServerInfoDialog = lazy(() =>
    import("@/features/server/ServerInfoDialog").then((module) => ({
        default: module.ServerInfoDialog,
    })),
);
const ErDialog = lazy(() =>
    import("@/features/er/ErDialog").then((module) => ({ default: module.ErDialog })),
);
const DumpDialog = lazy(() =>
    import("@/features/dump/DumpDialog").then((module) => ({ default: module.DumpDialog })),
);
const SettingsDialog = lazy(() =>
    import("@/features/settings/SettingsDialog").then((module) => ({
        default: module.SettingsDialog,
    })),
);
const HistoryDialog = lazy(() =>
    import("@/features/history/HistoryDialog").then((module) => ({
        default: module.HistoryDialog,
    })),
);

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
            <OnDemand when={(ui) => ui.structureRequest !== null}>
                <StructureDialog />
            </OnDemand>
            <OnDemand when={(ui) => ui.processListSession !== null}>
                <ProcessDialog />
            </OnDemand>
            <OnDemand when={(ui) => ui.designerRequest !== null}>
                <TableDesigner />
            </OnDemand>
            <OnDemand when={(ui) => ui.importRequest !== null}>
                <ImportDialog />
            </OnDemand>
            <OnDemand when={(ui) => ui.snippetsDialog !== null}>
                <SnippetsDialog />
            </OnDemand>
            <OnDemand when={(ui) => ui.explainRequest !== null}>
                <ExplainDialog />
            </OnDemand>
            <OnDemand when={(ui) => ui.serverInfoSession !== null}>
                <ServerInfoDialog />
            </OnDemand>
            <OnDemand when={(ui) => ui.erRequest !== null}>
                <ErDialog />
            </OnDemand>
            <OnDemand when={(ui) => ui.dumpRequest !== null}>
                <DumpDialog />
            </OnDemand>
            <CommandPalette />
            <OnDemand when={(ui) => ui.settingsOpen}>
                <SettingsDialog />
            </OnDemand>
            <OnDemand when={(ui) => ui.historyDialog !== null}>
                <HistoryDialog />
            </OnDemand>
            <Toaster theme={theme} position="bottom-right" />
        </>
    );
}
