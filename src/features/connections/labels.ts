import type { Engine } from "@/bindings/Engine";
import type { ProfileColor } from "@/bindings/ProfileColor";

export const ENGINE_LABELS: Record<Engine, string> = {
    mysql: "MySQL / MariaDB",
    postgres: "PostgreSQL",
    sqlite: "SQLite",
};

export const DEFAULT_PORTS: Record<Engine, number> = {
    mysql: 3306,
    postgres: 5432,
    sqlite: 0,
};

export const COLOR_CLASSES: Record<ProfileColor, string> = {
    none: "bg-muted-foreground/40",
    red: "bg-red-500",
    amber: "bg-amber-500",
    green: "bg-emerald-500",
    sky: "bg-sky-500",
    violet: "bg-violet-500",
};
