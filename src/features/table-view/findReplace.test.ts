import { describe, expect, it } from "vitest";
import { findReplacements, replaceInValue } from "./findReplace";

const base = { find: "", replace: "", matchCase: false, wholeCell: false };

describe("find and replace", () => {
    it("replaces every occurrence and treats the search text literally", () => {
        expect(replaceInValue("a.b a.b", { ...base, find: "a.b", replace: "x" })).toBe("x x");
        expect(replaceInValue("axb", { ...base, find: "a.b", replace: "x" })).toBeNull();
        expect(replaceInValue("Preis $5", { ...base, find: "$5", replace: "$$6" })).toBe(
            "Preis $$6",
        );
    });

    it("respects case and whole cell options", () => {
        expect(replaceInValue("Käse KÄSE", { ...base, find: "käse", replace: "Brot" })).toBe(
            "Brot Brot",
        );
        expect(
            replaceInValue("Käse KÄSE", {
                ...base,
                find: "käse",
                replace: "Brot",
                matchCase: true,
            }),
        ).toBeNull();
        expect(
            replaceInValue("Käse", { ...base, find: "KÄSE", replace: "Brot", wholeCell: true }),
        ).toBe("Brot");
        expect(
            replaceInValue("Käsebrot", { ...base, find: "Käse", replace: "x", wholeCell: true }),
        ).toBeNull();
        expect(replaceInValue("x", { ...base, find: "" })).toBeNull();
    });

    it("collects changes only in the chosen columns and skips NULL and unchanged cells", () => {
        const rows = [
            ["1", "alt", "alt"],
            ["2", null, "neu"],
            ["3", "Alter", "x"],
        ];
        expect(findReplacements(rows, [1, 2], { ...base, find: "alt", replace: "neu" })).toEqual([
            { row: 0, col: 1, value: "neu" },
            { row: 0, col: 2, value: "neu" },
            { row: 2, col: 1, value: "neuer" },
        ]);
        expect(findReplacements(rows, [1], { ...base, find: "neu", replace: "neu" })).toEqual([]);
    });
});
