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
        expect(messages.de.table.review(1)).toBe("1 Änderung prüfen");
        expect(messages.en.table.review(3)).toBe("Review 3 changes");
        expect(messages.de.query.results.size(1, 2)).toBe("1 Zeile · 2 Spalten");
        expect(messages.de.query.results.size(1204331, 1)).toBe("1.204.331 Zeilen · 1 Spalte");
        expect(messages.en.query.results.size(1, 1)).toBe("1 row · 1 column");
        expect(messages.en.settings.historyCleared(2)).toBe("2 entries deleted");
    });
});
