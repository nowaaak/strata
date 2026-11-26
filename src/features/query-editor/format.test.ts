import { describe, expect, it } from "vitest";
import { formatSql, formatterLanguage } from "./format";

describe("sql formatting", () => {
    it("picks the dialect from the engine and server flavor", () => {
        expect(formatterLanguage("postgres", "PostgreSQL")).toBe("postgresql");
        expect(formatterLanguage("mysql", "MariaDB")).toBe("mariadb");
        expect(formatterLanguage("mysql", "MySQL")).toBe("mysql");
        expect(formatterLanguage("mysql", undefined)).toBe("mysql");
    });

    it("uppercases keywords and indents with four spaces", () => {
        expect(formatSql("select id, name from kunden where id = 1", "mysql")).toBe(
            ["SELECT", "    id,", "    name", "FROM", "    kunden", "WHERE", "    id = 1"].join(
                "\n",
            ),
        );
    });

    it("keeps strings, comments and quoted identifiers intact", () => {
        const formatted = formatSql("select `größe`, 'a  b' -- bleibt\nfrom t", "mysql");
        expect(formatted).toContain("`größe`");
        expect(formatted).toContain("'a  b'");
        expect(formatted).toContain("-- bleibt");
    });

    it("understands postgres dollar quoting", () => {
        const formatted = formatSql("select $$it's$$::text as x", "postgresql");
        expect(formatted).toContain("$$it's$$");
    });
});

describe("data types", () => {
    it("uppercases data types like keywords", () => {
        expect(formatSql("create table t (id int, doc json)", "mysql")).toContain("id INT");
    });
});
