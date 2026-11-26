export type Mapping = Record<string, number | null>;

function normalize(value: string): string {
    return value
        .toLowerCase()
        .replace(/ß/g, "ss")
        .normalize("NFKD")
        .replace(/\p{Diacritic}/gu, "")
        .replace(/[^a-z0-9]/g, "");
}

export function autoMap(columns: string[], headers: string[], hasHeader: boolean): Mapping {
    const mapping: Mapping = {};
    const used = new Set<number>();
    for (const [position, column] of columns.entries()) {
        let source: number | null = null;
        if (hasHeader) {
            const wanted = normalize(column);
            const index = headers.findIndex(
                (header, candidate) => !used.has(candidate) && normalize(header) === wanted,
            );
            source = index >= 0 ? index : null;
        } else if (position < headers.length) {
            source = position;
        }
        if (source !== null) {
            used.add(source);
        }
        mapping[column] = source;
    }
    return mapping;
}

export function mappedCount(mapping: Mapping): number {
    return Object.values(mapping).filter((source) => source !== null).length;
}
