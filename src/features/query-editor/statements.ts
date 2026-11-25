import type { SqlStatement } from "@/bindings/SqlStatement";

export function statementAt(
    statements: SqlStatement[],
    position: number,
): SqlStatement | undefined {
    const containing = statements.find(
        (statement) => position >= statement.start && position <= statement.end + 1,
    );
    if (containing) {
        return containing;
    }
    const before = statements.filter((statement) => statement.end < position).at(-1);
    return before ?? statements[0];
}
