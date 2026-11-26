import { describe, expect, it } from "vitest";
import { countWarnings, parsePlan } from "./plan";

const MYSQL = `{"query_block":{"cost_info":{"query_cost":"0.80"},"nested_loop":[{"table":{"access_type":"ALL","attached_condition":"(\`strata\`.\`t\`.\`name\` = 'a')","cost_info":{"prefix_cost":"0.45"},"filtered":"50.00","possible_keys":["PRIMARY"],"rows_examined_per_scan":2,"table_name":"t"}},{"table":{"access_type":"eq_ref","cost_info":{"prefix_cost":"0.80"},"filtered":"100.00","key":"PRIMARY","ref":["strata.t.id"],"rows_examined_per_scan":1,"table_name":"u"}}],"select_id":1}}`;

const MARIADB = `{"query_block":{"cost":0.01378888,"nested_loop":[{"table":{"access_type":"ALL","attached_condition":"t.\`name\` = 'a'","cost":0.0111808,"filtered":100,"rows":5000,"table_name":"t"}},{"table":{"access_type":"eq_ref","key":"PRIMARY","rows":1,"table_name":"u"}}],"select_id":1}}`;

const POSTGRES = `[{"Execution Time":0.126,"Planning Time":0.2,"Plan":{"Actual Loops":1,"Actual Rows":1,"Actual Total Time":0.087,"Hash Cond":"(u.id = t.id)","Join Type":"Inner","Node Type":"Hash Join","Plan Rows":4,"Total Cost":42.67,"Plans":[{"Actual Loops":1,"Actual Rows":5000,"Actual Total Time":0.024,"Alias":"u","Node Type":"Seq Scan","Plan Rows":100,"Relation Name":"orders","Total Cost":19.0},{"Node Type":"Hash","Plan Rows":4,"Plans":[{"Alias":"t","Filter":"((name)::text = 'a'::text)","Node Type":"Seq Scan","Plan Rows":4,"Relation Name":"orders","Total Cost":21.25}]}]}}]`;

describe("plan parsing", () => {
    it("reads MySQL plans and flattens a single nested loop level", () => {
        const plan = parsePlan("mysql", MYSQL);
        expect(plan.root.title).toBe("Query block 1");
        expect(plan.root.cost).toBe(0.8);
        expect(plan.root.children).toHaveLength(1);
        const loop = plan.root.children[0]!;
        expect(loop.title).toBe("Nested Loop");
        expect(loop.children.map((child) => [child.title, child.target, child.rows])).toEqual([
            ["ALL", "t", 2],
            ["eq_ref", "u", 1],
        ]);
        expect(loop.children[0]?.details).toContainEqual({
            label: "Condition",
            value: "(`strata`.`t`.`name` = 'a')",
        });
        expect(countWarnings(plan.root)).toBe(0);
    });

    it("flags large full table scans in MariaDB plans", () => {
        const plan = parsePlan("mysql", MARIADB);
        const scan = plan.root.children[0]?.children[0];
        expect(scan?.warnings).toEqual(["fullScan"]);
        expect(plan.root.cost).toBeCloseTo(0.0138, 3);
    });

    it("reads PostgreSQL plans with actual numbers and misestimates", () => {
        const plan = parsePlan("postgres", POSTGRES);
        expect(plan.executionMs).toBe(0.126);
        expect(plan.planningMs).toBe(0.2);
        expect(plan.root.title).toBe("Hash Join");
        expect(plan.root.details).toContainEqual({ label: "Hash Cond", value: "(u.id = t.id)" });
        const scan = plan.root.children[0]!;
        expect(scan.target).toBe("orders u");
        expect(scan.warnings).toEqual(["fullScan", "misestimate"]);
        expect(plan.root.children[1]?.children[0]?.target).toBe("orders t");
        expect(countWarnings(plan.root)).toBe(2);
    });

    it("rejects unknown formats", () => {
        expect(() => parsePlan("postgres", "{}")).toThrow();
        expect(() => parsePlan("mysql", "[]")).toThrow();
        expect(() => parsePlan("sqlite", "[]")).toThrow();
    });

    it("builds a tree from SQLite query plan steps", () => {
        const plan = parsePlan(
            "sqlite",
            JSON.stringify({
                sqlite: [
                    { id: 2, parent: 0, detail: "SCAN b" },
                    { id: 4, parent: 0, detail: "SEARCH k USING INTEGER PRIMARY KEY (rowid=?)" },
                    { id: 7, parent: 0, detail: "USE TEMP B-TREE FOR ORDER BY" },
                    { id: 9, parent: 2, detail: "SCAN c USING COVERING INDEX c_x" },
                ],
            }),
        );
        expect(plan.root.title).toBe("QUERY PLAN");
        expect(plan.root.children.map((child) => child.title)).toEqual([
            "SCAN b",
            "SEARCH k USING INTEGER PRIMARY KEY (rowid=?)",
            "USE TEMP B-TREE FOR ORDER BY",
        ]);
        expect(plan.root.children[0]?.target).toBe("b");
        expect(plan.root.children[0]?.warnings).toEqual(["fullScan"]);
        expect(plan.root.children[0]?.children[0]?.warnings).toEqual([]);
        expect(plan.root.children[2]?.warnings).toEqual(["filesort"]);
        expect(countWarnings(plan.root)).toBe(2);
    });
});
