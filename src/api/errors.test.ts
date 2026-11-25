import { setLocale } from "@/i18n";
import { AppError, errorMessage } from "./invoke";
import { friendlyMessage } from "./errors";

beforeEach(() => setLocale("de"));

describe("friendlyMessage", () => {
    it("prefixes known kinds with an explanation in the active language", () => {
        expect(friendlyMessage("io", "access denied")).toBe(
            "Dateizugriff fehlgeschlagen (access denied)",
        );
        setLocale("en");
        expect(friendlyMessage("io", "access denied")).toBe("File access failed (access denied)");
    });

    it("returns the raw message for unknown kinds", () => {
        expect(friendlyMessage("something_new", "raw text")).toBe("raw text");
    });

    it("ignores inherited object keys", () => {
        expect(friendlyMessage("toString", "raw text")).toBe("raw text");
    });
});

describe("errorMessage", () => {
    it("formats AppError through the friendly table", () => {
        expect(errorMessage(new AppError("json", "line 1"))).toBe(
            "Datei ist beschädigt oder unlesbar (line 1)",
        );
    });

    it("falls back to plain errors and values", () => {
        expect(errorMessage(new Error("boom"))).toBe("boom");
        expect(errorMessage(42)).toBe("42");
    });
});
