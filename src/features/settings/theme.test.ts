import { resolveTheme, withOption } from "./theme";

describe("resolveTheme", () => {
    it("keeps explicit themes regardless of the system preference", () => {
        expect(resolveTheme("dark", false)).toBe("dark");
        expect(resolveTheme("light", true)).toBe("light");
    });

    it("follows the system preference for system", () => {
        expect(resolveTheme("system", true)).toBe("dark");
        expect(resolveTheme("system", false)).toBe("light");
    });
});

describe("withOption", () => {
    it("adds a custom value to the option list in order", () => {
        expect(withOption([10, 100], 50)).toEqual([10, 50, 100]);
        expect(withOption([10, 100], 10)).toEqual([10, 100]);
    });
});
