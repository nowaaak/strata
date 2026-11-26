import { describe, expect, it } from "vitest";
import { checkJson, isJsonDocument, reformatJson, savedJsonValue } from "./json";

describe("json values", () => {
    const compact =
        '{"v":1,"face":[0,0,67],"big":12345678901234567890,"price":1.10,"text":"a, b: {c}","esc":"q\\"x\\u00e4","empty":{},"list":[]}';

    it("pretty prints without touching numbers, strings or escapes", () => {
        const pretty = reformatJson(compact, 2);
        expect(pretty).toBe(
            [
                "{",
                '  "v": 1,',
                '  "face": [',
                "    0,",
                "    0,",
                "    67",
                "  ],",
                '  "big": 12345678901234567890,',
                '  "price": 1.10,',
                '  "text": "a, b: {c}",',
                '  "esc": "q\\"x\\u00e4",',
                '  "empty": {},',
                '  "list": []',
                "}",
            ].join("\n"),
        );
        expect(checkJson(pretty).ok).toBe(true);
    });

    it("compacts back to the exact original", () => {
        expect(reformatJson(reformatJson(compact, 2), null)).toBe(compact);
        expect(reformatJson('{ "a" : [ 1 , 2 ] }', null)).toBe('{"a":[1,2]}');
    });

    it("keeps compact values compact and formatted values formatted when saving", () => {
        const pretty = reformatJson(compact, 2);
        expect(savedJsonValue(compact, pretty)).toBe(compact);
        expect(savedJsonValue(null, pretty)).toBe(compact);
        expect(savedJsonValue(pretty, pretty)).toBe(pretty);
        expect(savedJsonValue(compact, "{broken")).toBe("{broken");
    });

    it("reports where the json breaks", () => {
        const result = checkJson('{\n  "a": 1,\n  "b" 2\n}');
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.line).toBe(3);
            expect(result.column).toBeGreaterThan(0);
        }
    });

    it("detects json documents but not scalars or text", () => {
        expect(isJsonDocument(' {"a": 1}')).toBe(true);
        expect(isJsonDocument("[1, 2]")).toBe(true);
        expect(isJsonDocument('"text"')).toBe(false);
        expect(isJsonDocument("{not json}")).toBe(false);
        expect(isJsonDocument(null)).toBe(false);
    });
});
