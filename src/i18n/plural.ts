export function counted(locale: string, value: number, one: string, other: string): string {
    return `${value.toLocaleString(locale)} ${value === 1 ? one : other}`;
}

export const de = (value: number, one: string, other: string) =>
    counted("de-DE", value, one, other);

export const en = (value: number, one: string, other: string) =>
    counted("en-US", value, one, other);
