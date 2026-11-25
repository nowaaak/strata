import type { ColumnKind } from "@/bindings/ColumnKind";
import type { ColumnMeta } from "@/bindings/ColumnMeta";
import { getT } from "@/i18n";

const formatters = new Map<string, Intl.NumberFormat>();

function numberFormat(): Intl.NumberFormat {
    const locale = getT().common.locale;
    let formatter = formatters.get(locale);
    if (!formatter) {
        formatter = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });
        formatters.set(locale, formatter);
    }
    return formatter;
}

export function formatCount(value: number): string {
    return numberFormat().format(value);
}

export function formatDuration(ms: number): string {
    if (ms < 1000) {
        return `${ms} ms`;
    }
    return `${numberFormat().format(ms / 1000)} s`;
}

export function displayText(value: string, kind: ColumnKind): string {
    if (kind === "boolean") {
        if (value === "t") {
            return "true";
        }
        if (value === "f") {
            return "false";
        }
    }
    const firstLine = value.length > 500 ? value.slice(0, 500) : value;
    return firstLine.replace(/\r?\n/g, " ↵ ").replace(/\t/g, " ");
}

export function isRightAligned(kind: ColumnKind): boolean {
    return kind === "number";
}

export function initialWidth(column: ColumnMeta): number {
    const header = column.name.length * 7.5 + column.typeName.length * 6.5 + 44;
    const byKind: Record<ColumnKind, number> = {
        number: 96,
        boolean: 72,
        temporal: 170,
        binary: 140,
        json: 220,
        text: 180,
    };
    return Math.round(Math.min(360, Math.max(72, header, byKind[column.kind])));
}

function tsvField(value: string | null | undefined): string {
    if (value === null || value === undefined) {
        return "";
    }
    if (/[\t\n\r"]/.test(value)) {
        return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
}

export function toTsv(header: string[] | null, rows: (string | null | undefined)[][]): string {
    const lines = rows.map((row) => row.map(tsvField).join("\t"));
    if (header) {
        lines.unshift(header.map(tsvField).join("\t"));
    }
    return lines.join("\r\n");
}

export function contentWidth(values: (string | null | undefined)[], header: string): number {
    const longest = values.reduce(
        (max, value) => Math.max(max, Math.min(80, (value ?? "NULL").length)),
        header.length,
    );
    return Math.round(Math.min(560, Math.max(64, longest * 7.4 + 28)));
}

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 365 * 24 * 3600],
    ["month", 30 * 24 * 3600],
    ["week", 7 * 24 * 3600],
    ["day", 24 * 3600],
    ["hour", 3600],
    ["minute", 60],
    ["second", 1],
];

export function formatRelative(timestamp: number, now = Date.now()): string {
    const seconds = Math.round((timestamp - now) / 1000);
    const format = new Intl.RelativeTimeFormat(getT().common.locale, { numeric: "auto" });
    for (const [unit, size] of UNITS) {
        if (Math.abs(seconds) >= size || unit === "second") {
            return format.format(Math.round(seconds / size), unit);
        }
    }
    return format.format(0, "second");
}

export function formatDateTime(timestamp: number): string {
    return new Intl.DateTimeFormat(getT().common.locale, {
        dateStyle: "medium",
        timeStyle: "medium",
    }).format(new Date(timestamp));
}
