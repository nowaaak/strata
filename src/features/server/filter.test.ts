import type { ServerSetting } from "@/bindings/ServerSetting";
import { durationSeconds, filterSettings } from "./filter";

const setting = (
    name: string,
    value: string,
    extra: Partial<ServerSetting> = {},
): ServerSetting => ({
    name,
    value,
    category: null,
    description: null,
    changed: false,
    editable: false,
    restart: false,
    ...extra,
});

const settings = [
    setting("max_connections", "151"),
    setting("shared_buffers", "128MB", {
        category: "Resource Usage / Memory",
        description: "Sets the number of shared memory buffers used by the server.",
        changed: true,
    }),
    setting("work_mem", "4MB"),
];

describe("filterSettings", () => {
    it("keeps everything without a search", () => {
        expect(filterSettings(settings, "  ", false)).toHaveLength(3);
    });

    it("matches name, value and description, every term must match", () => {
        expect(filterSettings(settings, "conn", false).map((s) => s.name)).toEqual([
            "max_connections",
        ]);
        expect(filterSettings(settings, "4mb", false).map((s) => s.name)).toEqual(["work_mem"]);
        expect(filterSettings(settings, "memory buffers", false).map((s) => s.name)).toEqual([
            "shared_buffers",
        ]);
        expect(filterSettings(settings, "memory work", false)).toEqual([]);
    });

    it("can show only changed values", () => {
        expect(filterSettings(settings, "", true).map((s) => s.name)).toEqual(["shared_buffers"]);
    });
});

describe("durationSeconds", () => {
    it("reads MySQL uptime counters only", () => {
        expect(durationSeconds("Uptime", "93784")).toBe(93784);
        expect(durationSeconds("Uptime_since_flush_status", "60")).toBe(60);
        expect(durationSeconds("Questions", "60")).toBeNull();
        expect(durationSeconds("uptime", "1 day 02:03:04")).toBeNull();
    });
});
