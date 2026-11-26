import { describe, expect, it } from "vitest";
import { dbHintKey } from "./dbErrors";

describe("database error hints", () => {
    it("reads MySQL and MariaDB error codes", () => {
        expect(dbHintKey("ERROR 1062 (23000): Duplicate entry '1' for key 'PRIMARY'")).toBe(
            "duplicate",
        );
        expect(dbHintKey("ERROR 1146 (42S02): Table 'shop.x' doesn't exist")).toBe("unknownTable");
        expect(dbHintKey("ERROR 1451 (23000): Cannot delete or update a parent row")).toBe(
            "referenced",
        );
        expect(dbHintKey("ERROR 9999 (HY000): something new")).toBeNull();
    });

    it("reads PostgreSQL SQLSTATE codes regardless of the server language", () => {
        expect(
            dbHintKey('ERROR 23505: doppelter Schlüsselwert verletzt Unique-Constraint "k"'),
        ).toBe("duplicate");
        expect(dbHintKey('ERROR 42P01: relation "x" does not exist')).toBe("unknownTable");
        expect(
            dbHintKey(
                'ERROR 23503: update or delete on table "p" violates foreign key constraint "f"',
            ),
        ).toBe("referenced");
        expect(dbHintKey('ERROR 23503: insert or update on table "c" violates foreign key')).toBe(
            "missingReference",
        );
        expect(dbHintKey('FATAL 28P01: password authentication failed for user "x"')).toBe(
            "accessDenied",
        );
    });

    it("recognises connection problems", () => {
        expect(
            dbHintKey(
                "error connecting to server: Es konnte keine Verbindung hergestellt werden (os error 10061)",
            ),
        ).toBe("refused");
        expect(dbHintKey("Connection refused (os error 111)")).toBe("refused");
        expect(dbHintKey("connection timed out")).toBe("timeout");
        expect(dbHintKey("plain text")).toBeNull();
    });
});
