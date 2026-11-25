import { getT } from "@/i18n";

export function friendlyMessage(kind: string, message: string): string {
    const messages = getT().errors.friendly;
    const friendly = Object.hasOwn(messages, kind) ? messages[kind] : undefined;
    return friendly ? `${friendly} (${message})` : message;
}
