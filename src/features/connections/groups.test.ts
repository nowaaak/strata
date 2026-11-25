import type { ConnectionProfile } from "@/bindings/ConnectionProfile";
import { groupNames, groupProfiles } from "./groups";

function profile(name: string, group: string | null): ConnectionProfile {
    return {
        id: name,
        name,
        engine: "mysql",
        host: "localhost",
        port: 3306,
        user: "root",
        database: null,
        tls: "disabled",
        color: "none",
        safety: "normal",
        askPassword: false,
        group,
    };
}

describe("groupProfiles", () => {
    it("sorts groups and members by name, numbers naturally", () => {
        const result = groupProfiles([
            profile("Shop 10", "Produktion"),
            profile("lokal", null),
            profile("Shop 2", "Produktion"),
            profile("Alpha", null),
            profile("Backup", "Archiv"),
        ]);
        expect(result.ungrouped.map((entry) => entry.name)).toEqual(["Alpha", "lokal"]);
        expect(result.groups.map((group) => group.name)).toEqual(["Archiv", "Produktion"]);
        expect(result.groups[1]?.profiles.map((entry) => entry.name)).toEqual([
            "Shop 2",
            "Shop 10",
        ]);
    });

    it("lists distinct group names", () => {
        expect(groupNames([profile("a", "X"), profile("b", "X"), profile("c", null)])).toEqual([
            "X",
        ]);
    });
});
