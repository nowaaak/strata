import { setLocale } from "@/i18n";
import { displayText, formatCount, initialWidth, toTsv } from "./format";

describe("toTsv", () => {
    it("joins cells with tabs and quotes special values", () => {
        expect(
            toTsv(
                ["id", "note"],
                [
                    ["1", 'say "hi"'],
                    ["2", null],
                    ["3", "a\tb"],
                ],
            ),
        ).toBe('id\tnote\r\n1\t"say ""hi"""\r\n2\t\r\n3\t"a\tb"');
    });

    it("omits the header when not requested", () => {
        expect(toTsv(null, [["x"]])).toBe("x");
    });
});

describe("displayText", () => {
    it("renders postgres booleans and flattens line breaks", () => {
        expect(displayText("t", "boolean")).toBe("true");
        expect(displayText("a\nb", "text")).toBe("a ↵ b");
    });
});

describe("formatting helpers", () => {
    it("formats counts in the active language and bounds widths", () => {
        setLocale("de");
        expect(formatCount(1204331)).toBe("1.204.331");
        setLocale("en");
        expect(formatCount(1204331)).toBe("1,204,331");
        const width = initialWidth({ name: "x".repeat(200), typeName: "", kind: "text" });
        expect(width).toBe(360);
    });
});
