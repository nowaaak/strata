export type FindOptions = {
    find: string;
    replace: string;
    matchCase: boolean;
    wholeCell: boolean;
};

export type Replacement = { row: number; col: number; value: string };

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function replaceInValue(value: string, options: FindOptions): string | null {
    if (options.find === "") {
        return null;
    }
    if (options.wholeCell) {
        const equal = options.matchCase
            ? value === options.find
            : value.toLocaleLowerCase() === options.find.toLocaleLowerCase();
        return equal ? options.replace : null;
    }
    const pattern = new RegExp(escapeRegExp(options.find), options.matchCase ? "g" : "gi");
    if (!pattern.test(value)) {
        return null;
    }
    pattern.lastIndex = 0;
    return value.replace(pattern, () => options.replace);
}

export function findReplacements(
    rows: (string | null)[][],
    columns: number[],
    options: FindOptions,
): Replacement[] {
    const replacements: Replacement[] = [];
    rows.forEach((row, index) => {
        for (const col of columns) {
            const value = row[col];
            if (value === null || value === undefined) {
                continue;
            }
            const next = replaceInValue(value, options);
            if (next !== null && next !== value) {
                replacements.push({ row: index, col, value: next });
            }
        }
    });
    return replacements;
}
