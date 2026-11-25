import type { SqlStatement } from "@/bindings/SqlStatement";
import { statementAt } from "./statements";

const statements: SqlStatement[] = [
    { text: "SELECT 1", start: 0, end: 8, writes: false },
    { text: "SELECT 2", start: 12, end: 20, writes: false },
];

describe("statementAt", () => {
    it("finds the statement containing the cursor or touching its delimiter", () => {
        expect(statementAt(statements, 3)?.text).toBe("SELECT 1");
        expect(statementAt(statements, 9)?.text).toBe("SELECT 1");
        expect(statementAt(statements, 15)?.text).toBe("SELECT 2");
    });

    it("falls back to the previous statement in blank space", () => {
        expect(statementAt(statements, 11)?.text).toBe("SELECT 1");
        expect(statementAt(statements, 40)?.text).toBe("SELECT 2");
    });

    it("returns nothing for an empty script", () => {
        expect(statementAt([], 0)).toBeUndefined();
    });
});
