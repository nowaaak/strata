import { describe, expect, it } from "vitest";
import type { UserAccount } from "@/bindings/UserAccount";
import {
    accountLabel,
    buildScope,
    filterAccounts,
    privilegeChoices,
    scopeKinds,
    scopeObject,
} from "./privileges";

const account = (name: string, host: string | null): UserAccount => ({
    name,
    host,
    canLogin: true,
    superuser: false,
    attributes: [],
    memberOf: [],
    validUntil: null,
});

describe("privileges", () => {
    it("offers scopes per engine", () => {
        expect(scopeKinds("mysql")).toEqual(["global", "database", "table"]);
        expect(scopeKinds("postgres")).toEqual(["database", "schema", "all_tables", "table"]);
    });

    it("offers narrower privileges for narrower scopes", () => {
        expect(privilegeChoices("mysql", "global")).toContain("PROCESS");
        expect(privilegeChoices("mysql", "database")).not.toContain("PROCESS");
        expect(privilegeChoices("mysql", "table")).not.toContain("EXECUTE");
        expect(privilegeChoices("postgres", "database")).toEqual([
            "CONNECT",
            "CREATE",
            "TEMPORARY",
        ]);
        expect(privilegeChoices("postgres", "all_tables")).toContain("TRUNCATE");
    });

    it("builds scopes only when the object is complete", () => {
        expect(buildScope("database", "", "", "")).toBeNull();
        expect(buildScope("table", "shop", "", "kunden")).toEqual({
            kind: "table",
            database: "shop",
            schema: null,
            table: "kunden",
        });
        expect(buildScope("all_tables", "shop", "public", "")).toEqual({
            kind: "all_tables",
            schema: "public",
        });
        expect(buildScope("schema", "shop", "", "")).toBeNull();
    });

    it("labels objects and accounts", () => {
        expect(scopeObject({ kind: "global" })).toBe("*.*");
        expect(scopeObject({ kind: "table", database: "shop", schema: "public", table: "k" })).toBe(
            "public.k",
        );
        expect(scopeObject({ kind: "table", database: "shop", schema: null, table: "k" })).toBe(
            "shop.k",
        );
        expect(accountLabel({ name: "app", host: "%" })).toBe("app@%");
        expect(accountLabel({ name: "app", host: null })).toBe("app");
    });

    it("filters accounts by name and host", () => {
        const accounts = [account("app", "%"), account("root", "localhost")];
        expect(filterAccounts(accounts, "LOCAL").map((entry) => entry.name)).toEqual(["root"]);
        expect(filterAccounts(accounts, " ")).toHaveLength(2);
    });
});
