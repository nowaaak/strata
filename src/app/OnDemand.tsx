import { Suspense, useState, type ReactNode } from "react";
import { useUiStore, type UiState } from "./uiStore";

export function OnDemand({
    when,
    children,
}: {
    when: (ui: UiState) => boolean;
    children: ReactNode;
}) {
    const requested = useUiStore(when);
    const [mounted, setMounted] = useState(false);
    if (requested && !mounted) {
        setMounted(true);
    }
    return mounted ? <Suspense fallback={null}>{children}</Suspense> : null;
}
