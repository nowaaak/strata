export type JsonCheck =
    { ok: true } | { ok: false; message: string; line: number | null; column: number | null };

function locate(text: string, message: string): { line: number | null; column: number | null } {
    const lineColumn = /line (\d+) column (\d+)/.exec(message);
    if (lineColumn) {
        return { line: Number(lineColumn[1]), column: Number(lineColumn[2]) };
    }
    const position = /position (\d+)/.exec(message);
    if (!position) {
        return { line: null, column: null };
    }
    const before = text.slice(0, Number(position[1]));
    const lines = before.split("\n");
    return { line: lines.length, column: (lines.at(-1)?.length ?? 0) + 1 };
}

export function checkJson(text: string): JsonCheck {
    try {
        JSON.parse(text);
        return { ok: true };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { ok: false, message, ...locate(text, message) };
    }
}

export function isJsonDocument(value: string | null): boolean {
    if (value === null) {
        return false;
    }
    const trimmed = value.trimStart();
    return (trimmed.startsWith("{") || trimmed.startsWith("[")) && checkJson(value).ok;
}

export function isCompact(value: string): boolean {
    return !value.trim().includes("\n");
}

export function reformatJson(text: string, indent: number | null): string {
    const pad = (depth: number) => (indent === null ? "" : "\n" + " ".repeat(indent * depth));
    let out = "";
    let depth = 0;
    let index = 0;
    while (index < text.length) {
        const char = text[index] ?? "";
        if (char === '"') {
            let end = index + 1;
            while (end < text.length && text[end] !== '"') {
                end += text[end] === "\\" ? 2 : 1;
            }
            out += text.slice(index, end + 1);
            index = end + 1;
            continue;
        }
        if (char === " " || char === "\t" || char === "\n" || char === "\r") {
            index += 1;
            continue;
        }
        if (char === "{" || char === "[") {
            let next = index + 1;
            while (next < text.length && /\s/.test(text[next] ?? "")) {
                next += 1;
            }
            const closing = char === "{" ? "}" : "]";
            if (text[next] === closing) {
                out += char + closing;
                index = next + 1;
                continue;
            }
            depth += 1;
            out += char + pad(depth);
            index += 1;
            continue;
        }
        if (char === "}" || char === "]") {
            depth = Math.max(0, depth - 1);
            out += pad(depth) + char;
            index += 1;
            continue;
        }
        if (char === ",") {
            out += "," + pad(depth);
            index += 1;
            continue;
        }
        if (char === ":") {
            out += indent === null ? ":" : ": ";
            index += 1;
            continue;
        }
        out += char;
        index += 1;
    }
    return out;
}

export function savedJsonValue(original: string | null, edited: string): string {
    if (!checkJson(edited).ok) {
        return edited;
    }
    if (original === null || isCompact(original)) {
        return reformatJson(edited, null);
    }
    return edited;
}
