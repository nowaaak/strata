import { getT } from "@/i18n";
import { dbHintKey } from "@/lib/dbErrors";

export function dbHint(message: string): string | null {
    const key = dbHintKey(message);
    return key ? getT().errors.hints[key] : null;
}

export function friendlyMessage(kind: string, message: string): string {
    if (kind === "database" || kind === "connection") {
        const hint = dbHint(message);
        if (hint) {
            return `${hint} (${message})`;
        }
    }
    const messages = getT().errors.friendly;
    const friendly = Object.hasOwn(messages, kind) ? messages[kind] : undefined;
    return friendly ? `${friendly} (${message})` : message;
}
