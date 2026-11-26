import { describe, expect, it } from "vitest";
import { autoMap, mappedCount } from "./mapping";

describe("csv column mapping", () => {
    it("matches header names loosely and uses each csv column once", () => {
        const mapping = autoMap(
            ["id", "first_name", "größe", "note"],
            ["ID", "First Name", "Grösse", "id"],
            true,
        );
        expect(mapping).toEqual({ id: 0, first_name: 1, größe: 2, note: null });
        expect(mappedCount(mapping)).toBe(3);
    });

    it("maps by position without a header row", () => {
        expect(autoMap(["a", "b", "c"], ["#1", "#2"], false)).toEqual({ a: 0, b: 1, c: null });
    });
});
