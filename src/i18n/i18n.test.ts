import { resolveLocale } from "./index";
import { messages } from "./messages";

function shape(value: unknown): unknown {
    if (typeof value === "function") {
        return "fn";
    }
    if (value && typeof value === "object") {
        return Object.fromEntries(
            Object.entries(value)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([key, entry]) => [key, shape(entry)]),
        );
    }
    return typeof value;
}

describe("i18n", () => {
    it("resolves the system language", () => {
        expect(resolveLocale("system", "de-AT")).toBe("de");
        expect(resolveLocale("system", "fr-FR")).toBe("en");
        expect(resolveLocale("en", "de-DE")).toBe("en");
    });

    it("has the same keys in every language, including dynamic error tables", () => {
        expect(shape(messages.en)).toEqual(shape(messages.de));
    });

    it("translates plurals and placeholders", () => {
        expect(messages.de.table.review("1", true)).toBe("1 Änderung prüfen");
        expect(messages.en.table.review("3", false)).toBe("Review 3 changes");
    });
});
