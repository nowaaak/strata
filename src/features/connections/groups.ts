import type { ConnectionProfile } from "@/bindings/ConnectionProfile";

export type ProfileGroup = { name: string; profiles: ConnectionProfile[] };

function byName(a: { name: string }, b: { name: string }): number {
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true });
}

export function groupProfiles(profiles: ConnectionProfile[]): {
    ungrouped: ConnectionProfile[];
    groups: ProfileGroup[];
} {
    const ungrouped: ConnectionProfile[] = [];
    const groups = new Map<string, ConnectionProfile[]>();
    for (const profile of profiles) {
        if (profile.group) {
            groups.set(profile.group, [...(groups.get(profile.group) ?? []), profile]);
        } else {
            ungrouped.push(profile);
        }
    }
    return {
        ungrouped: ungrouped.sort(byName),
        groups: [...groups]
            .map(([name, members]) => ({ name, profiles: members.sort(byName) }))
            .sort(byName),
    };
}

export function groupNames(profiles: ConnectionProfile[]): string[] {
    return groupProfiles(profiles).groups.map((group) => group.name);
}
