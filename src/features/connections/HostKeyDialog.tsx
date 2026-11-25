import { useQueryClient } from "@tanstack/react-query";
import { ShieldQuestionIcon } from "lucide-react";
import { toast } from "sonner";
import { errorMessage } from "@/api/invoke";
import { setSshHostKey } from "@/api/profiles";
import { useUiStore } from "@/app/uiStore";
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
import { useT } from "@/i18n";
import { connectProfile } from "./connect";
import { profilesKey } from "./useProfiles";

export function HostKeyDialog() {
    const t = useT();
    const text = t.connections.ssh;
    const queryClient = useQueryClient();
    const prompt = useUiStore((ui) => ui.hostKeyPrompt);
    const close = () => useUiStore.getState().setHostKeyPrompt(null);

    const trust = async () => {
        if (!prompt) {
            return;
        }
        close();
        try {
            const updated = await setSshHostKey(prompt.profile.id, prompt.fingerprint);
            await queryClient.invalidateQueries({ queryKey: profilesKey });
            await connectProfile(updated, prompt.password);
        } catch (error) {
            toast.error(text.trustFailed, { description: errorMessage(error) });
        }
    };

    return (
        <AlertDialog open={prompt !== null} onOpenChange={(open) => !open && close()}>
            <AlertDialogContent className="sm:max-w-lg">
                <AlertDialogHeader>
                    <AlertDialogTitle className="flex items-center gap-2">
                        <ShieldQuestionIcon className="size-5 text-amber-500" aria-hidden />
                        {text.unknownTitle}
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                        {text.unknownDescription(
                            prompt?.profile.ssh
                                ? `${prompt.profile.ssh.host}:${prompt.profile.ssh.port}`
                                : "",
                        )}
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <div className="flex flex-col gap-1">
                    <span className="text-xs text-muted-foreground">{text.fingerprint}</span>
                    <code className="rounded-md bg-muted px-3 py-2 font-mono text-xs break-all select-text">
                        {prompt?.fingerprint}
                    </code>
                </div>
                <AlertDialogFooter>
                    <AlertDialogCancel>{t.common.cancel}</AlertDialogCancel>
                    <AlertDialogAction
                        onClick={(event) => {
                            event.preventDefault();
                            void trust();
                        }}
                    >
                        {text.trust}
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}
