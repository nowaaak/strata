import { describe, expect, it } from "vitest";
import type { DdlAction } from "@/bindings/DdlAction";
import { de } from "@/i18n/modules/structure";
import {
    createTableTemplate,
    editableValue,
    isUnchangedRename,
    needsTypedConfirmation,
    titleOf,
    verbOf,
    withValue,
} from "./actions";

const target = { database: "shop", schema: "public", table: "orders" };

describe("structure actions", () => {
    it("edits the name of create and the new name of rename actions only", () => {
        const create: DdlAction = { action: "create_database", name: "" };
        expect(withValue(create, "neu")).toEqual({ action: "create_database", name: "neu" });

        const rename: DdlAction = { action: "rename_object", target, kind: "table", to: "orders" };
        expect(isUnchangedRename(rename)).toBe(true);
        const renamed = withValue(rename, "orders_alt");
        expect(editableValue(renamed)).toBe("orders_alt");
        expect(isUnchangedRename(renamed)).toBe(false);

        const drop: DdlAction = { action: "drop_object", target, kind: "view" };
        expect(editableValue(drop)).toBeNull();
        expect(withValue(drop, "x")).toBe(drop);
    });

    it("classifies destructive actions and asks for the name only when dropping databases", () => {
        expect(verbOf({ action: "truncate_table", target })).toBe("truncate");
        expect(
            verbOf({ action: "drop_schema", database: "shop", schema: "a", cascade: false }),
        ).toBe("drop");
        expect(needsTypedConfirmation({ action: "drop_database", database: "shop" })).toBe(true);
        expect(needsTypedConfirmation({ action: "drop_object", target, kind: "table" })).toBe(
            false,
        );
    });

    it("names views and tables in titles", () => {
        expect(titleOf(de, { action: "drop_object", target, kind: "view" })).toBe(
            "View „orders“ löschen?",
        );
        expect(titleOf(de, { action: "truncate_table", target })).toBe("Tabelle „orders“ leeren?");
    });

    it("quotes identifiers in the create table template", () => {
        expect(createTableTemplate("mysql", "sh`op", null, "neu").split("\n")[0]).toBe(
            "CREATE TABLE `sh``op`.`neu` (",
        );
        expect(createTableTemplate("postgres", "shop", 'ar"chiv', "neu").split("\n")[0]).toBe(
            'CREATE TABLE "ar""chiv"."neu" (',
        );
    });
});
