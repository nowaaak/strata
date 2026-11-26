import type { ServerSetting } from "@/bindings/ServerSetting";
import { normalize } from "@/lib/fuzzy";

export function filterSettings(
    settings: ServerSetting[],
    search: string,
    onlyChanged: boolean,
): ServerSetting[] {
    const terms = normalize(search).split(/\s+/).filter(Boolean);
    return settings.filter((setting) => {
        if (onlyChanged && !setting.changed) {
            return false;
        }
        if (terms.length === 0) {
            return true;
        }
        const haystack = normalize(
            [setting.name, setting.value, setting.category ?? "", setting.description ?? ""].join(
                " ",
            ),
        );
        return terms.every((term) => haystack.includes(term));
    });
}

export function durationSeconds(name: string, value: string): number | null {
    if (!/^Uptime/.test(name) || !/^\d+$/.test(value)) {
        return null;
    }
    return Number(value);
}
