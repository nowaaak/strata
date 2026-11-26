import { describe, expect, it } from "vitest";
import { formatDuration } from "./duration";

describe("formatDuration", () => {
    it("uses the two largest units", () => {
        expect(formatDuration(null)).toBe("");
        expect(formatDuration(0)).toBe("0 s");
        expect(formatDuration(59)).toBe("59 s");
        expect(formatDuration(60)).toBe("1 min");
        expect(formatDuration(185)).toBe("3 min 5 s");
        expect(formatDuration(3600)).toBe("1 h");
        expect(formatDuration(7500)).toBe("2 h 5 min");
        expect(formatDuration(90_000)).toBe("1 d 1 h");
        expect(formatDuration(172_800)).toBe("2 d");
    });
});
