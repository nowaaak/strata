import type { DdlAction } from "@/bindings/DdlAction";
import type { Messages } from "@/i18n/messages";

export type StructureVerb = "create" | "rename" | "truncate" | "drop";

export function verbOf(action: DdlAction): StructureVerb {
    switch (action.action) {
        case "create_database":
        case "create_schema":
            return "create";
        case "rename_database":
        case "rename_schema":
        case "rename_object":
            return "rename";
        case "truncate_table":
            return "truncate";
        case "drop_database":
        case "drop_schema":
        case "drop_object":
        case "drop_routine":
            return "drop";
    }
}

export function subjectOf(action: DdlAction): string {
    switch (action.action) {
        case "create_database":
        case "create_schema":
            return action.name;
        case "rename_database":
        case "drop_database":
            return action.database;
        case "rename_schema":
        case "drop_schema":
            return action.schema;
        case "rename_object":
        case "truncate_table":
        case "drop_object":
            return action.target.table;
        case "drop_routine":
            return action.target.routine.arguments !== null
                ? `${action.target.routine.name}(${action.target.routine.arguments})`
                : action.target.routine.name;
    }
}

export function editableValue(action: DdlAction): string | null {
    switch (action.action) {
        case "create_database":
        case "create_schema":
            return action.name;
        case "rename_database":
        case "rename_schema":
        case "rename_object":
            return action.to;
        default:
            return null;
    }
}

export function withValue(action: DdlAction, value: string): DdlAction {
    switch (action.action) {
        case "create_database":
        case "create_schema":
            return { ...action, name: value };
        case "rename_database":
        case "rename_schema":
        case "rename_object":
            return { ...action, to: value };
        default:
            return action;
    }
}

export function isUnchangedRename(action: DdlAction): boolean {
    switch (action.action) {
        case "rename_database":
            return action.to === action.database;
        case "rename_schema":
            return action.to === action.schema;
        case "rename_object":
            return action.to === action.target.table;
        default:
            return false;
    }
}

export function needsTypedConfirmation(action: DdlAction): boolean {
    return action.action === "drop_database";
}

export function titleOf(text: Messages["structure"], action: DdlAction): string {
    const subject = subjectOf(action);
    switch (action.action) {
        case "create_database":
            return text.title.create_database;
        case "create_schema":
            return text.title.create_schema(action.database);
        case "rename_database":
            return text.title.rename_database(subject);
        case "drop_database":
            return text.title.drop_database(subject);
        case "rename_schema":
            return text.title.rename_schema(subject);
        case "drop_schema":
            return text.title.drop_schema(subject);
        case "rename_object":
            return action.kind === "view"
                ? text.title.rename_view(subject)
                : text.title.rename_table(subject);
        case "truncate_table":
            return text.title.truncate_table(subject);
        case "drop_object":
            return action.kind === "view"
                ? text.title.drop_view(subject)
                : text.title.drop_table(subject);
        case "drop_routine":
            return text.title.drop_routine(action.target.routine.kind, subject);
    }
}

export function descriptionOf(text: Messages["structure"], action: DdlAction): string {
    switch (action.action) {
        case "create_database":
        case "create_schema":
            return text.description.create;
        case "rename_database":
        case "rename_schema":
        case "rename_object":
            return text.description.rename;
        case "drop_database":
            return text.description.drop_database;
        case "drop_schema":
            return text.description.drop_schema;
        case "truncate_table":
            return text.description.truncate;
        case "drop_object":
            return text.description.drop;
        case "drop_routine":
            return text.description.drop_routine;
    }
}

export function createTableTemplate(
    engine: "mysql" | "postgres",
    database: string,
    schema: string | null,
    name: string,
): string {
    if (engine === "postgres") {
        const quote = (value: string) => `"${value.replace(/"/g, '""')}"`;
        const table = schema ? `${quote(schema)}.${quote(name)}` : quote(name);
        return [
            `CREATE TABLE ${table} (`,
            "    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,",
            "    name text NOT NULL,",
            "    created_at timestamptz NOT NULL DEFAULT now()",
            ");",
        ].join("\n");
    }
    const quote = (value: string) => `\`${value.replace(/`/g, "``")}\``;
    return [
        `CREATE TABLE ${quote(database)}.${quote(name)} (`,
        "    id INT UNSIGNED NOT NULL AUTO_INCREMENT,",
        "    name VARCHAR(255) NOT NULL,",
        "    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,",
        "    PRIMARY KEY (id)",
        ");",
    ].join("\n");
}
