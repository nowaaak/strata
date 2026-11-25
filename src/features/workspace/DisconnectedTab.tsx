import { Loader2Icon, PlugIcon, UnplugIcon, XIcon } from "lucide-react";
import { useUiStore } from "@/app/uiStore";
import { Button } from "@/components/ui/button";
import { closeWorkspaceTab, requestConnect } from "@/features/connections/connect";
import { useProfile, useProfiles } from "@/features/connections/useProfiles";
import { SqlEditor } from "@/features/query-editor/SqlEditor";
import { useT } from "@/i18n";
import { tabTitle, type WorkspaceTab } from "./workspaceStore";

export function DisconnectedTab({ tab }: { tab: WorkspaceTab }) {
    const t = useT();
    const text = t.app.workspace;
    const profiles = useProfiles();
    const profile = useProfile(tab.profileId);
    const connecting = useUiStore((ui) => ui.connecting[tab.profileId] ?? false);
    const missing = profiles.isSuccess && !profile;

    return (
        <div className="flex h-full min-h-0 flex-col">
            <div className="flex shrink-0 items-center gap-3 border-b bg-muted/30 px-4 py-3">
                <UnplugIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{text.disconnected}</p>
                    <p className="truncate text-xs text-muted-foreground">
                        {missing ? text.missingProfile : text.disconnectedText(profile?.name ?? "")}
                    </p>
                </div>
                {missing ? (
                    <Button size="sm" variant="outline" onClick={() => closeWorkspaceTab(tab.id)}>
                        <XIcon />
                        {text.closeTab}
                    </Button>
                ) : (
                    <Button
                        size="sm"
                        disabled={!profile || connecting}
                        onClick={() => profile && requestConnect(profile)}
                    >
                        {connecting ? (
                            <Loader2Icon className="animate-spin motion-reduce:animate-none" />
                        ) : (
                            <PlugIcon />
                        )}
                        {text.connect}
                    </Button>
                )}
            </div>
            {tab.kind === "query" && tab.sql.trim() !== "" && (
                <div className="min-h-0 flex-1 opacity-80">
                    <SqlEditor
                        key={tab.sql}
                        label={t.query.editorLabel(tabTitle(tab, t))}
                        initialValue={tab.sql}
                        engine={profile?.engine ?? "mysql"}
                        readOnly
                    />
                </div>
            )}
        </div>
    );
}
