import { useId, useState, type FormEvent } from "react";
import { useUiStore } from "@/app/uiStore";
import type { ConnectionProfile } from "@/bindings/ConnectionProfile";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useT } from "@/i18n";
import { connectProfile } from "./connect";

export function PasswordDialog() {
    const profile = useUiStore((ui) => ui.passwordPrompt);
    const close = () => useUiStore.getState().setPasswordPrompt(null);

    return (
        <Dialog open={profile !== null} onOpenChange={(open) => !open && close()}>
            <DialogContent className="sm:max-w-sm">
                {profile && <PasswordForm key={profile.id} profile={profile} onDone={close} />}
            </DialogContent>
        </Dialog>
    );
}

function PasswordForm({ profile, onDone }: { profile: ConnectionProfile; onDone: () => void }) {
    const t = useT();
    const text = t.connections.password;
    const id = useId();
    const [password, setPassword] = useState("");

    const onSubmit = (event: FormEvent) => {
        event.preventDefault();
        onDone();
        void connectProfile(profile, password);
    };

    return (
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
            <DialogHeader>
                <DialogTitle>{text.title(profile.name)}</DialogTitle>
                <DialogDescription>
                    {text.description(`${profile.user}@${profile.host}:${profile.port}`)}
                </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-1.5">
                <Label htmlFor={id}>{text.label}</Label>
                <Input
                    id={id}
                    type="password"
                    autoFocus
                    autoComplete="current-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                />
            </div>
            <DialogFooter>
                <Button type="button" variant="ghost" onClick={onDone}>
                    {t.common.cancel}
                </Button>
                <Button type="submit">{text.connect}</Button>
            </DialogFooter>
        </form>
    );
}
