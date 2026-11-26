export type PlanWarning = "fullScan" | "filesort" | "temporary" | "misestimate" | "diskSort";

export type PlanNode = {
    title: string;
    target: string | null;
    details: { label: string; value: string }[];
    rows: number | null;
    cost: number | null;
    actualRows: number | null;
    actualMs: number | null;
    warnings: PlanWarning[];
    children: PlanNode[];
};

export type Plan = {
    root: PlanNode;
    planningMs: number | null;
    executionMs: number | null;
};

const LARGE_SCAN = 1000;

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function num(value: unknown): number | null {
    if (typeof value === "number" && Number.isFinite(value)) {
        return value;
    }
    if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
        return Number(value);
    }
    return null;
}

function str(value: unknown): string | null {
    if (typeof value === "string" && value !== "") {
        return value;
    }
    if (Array.isArray(value) && value.length > 0) {
        return value.map(String).join(", ");
    }
    return null;
}

function node(title: string, target: string | null = null): PlanNode {
    return {
        title,
        target,
        details: [],
        rows: null,
        cost: null,
        actualRows: null,
        actualMs: null,
        warnings: [],
        children: [],
    };
}

function detail(target: PlanNode, label: string, value: unknown) {
    const text = str(value) ?? (typeof value === "number" ? String(value) : null);
    if (text !== null) {
        target.details.push({ label, value: text });
    }
}

const PG_DETAILS = [
    "Index Name",
    "Index Cond",
    "Recheck Cond",
    "Filter",
    "Rows Removed by Filter",
    "Join Filter",
    "Hash Cond",
    "Merge Cond",
    "Join Type",
    "Sort Key",
    "Sort Method",
    "Group Key",
    "Strategy",
    "CTE Name",
    "Subplan Name",
];

function pgNode(plan: Json): PlanNode {
    const relation = str(plan["Relation Name"]);
    const alias = str(plan["Alias"]);
    const target =
        relation && alias && alias !== relation ? `${relation} ${alias}` : (relation ?? null);
    const result = node(str(plan["Node Type"]) ?? "?", target);
    for (const key of PG_DETAILS) {
        detail(result, key, plan[key]);
    }
    result.rows = num(plan["Plan Rows"]);
    result.cost = num(plan["Total Cost"]);
    const loops = num(plan["Actual Loops"]) ?? 1;
    const actual = num(plan["Actual Rows"]);
    result.actualRows = actual === null ? null : actual * loops;
    const time = num(plan["Actual Total Time"]);
    result.actualMs = time === null ? null : time * loops;
    const scanned = result.actualRows ?? result.rows ?? 0;
    if (result.title === "Seq Scan" && scanned >= LARGE_SCAN) {
        result.warnings.push("fullScan");
    }
    if (
        result.actualRows !== null &&
        result.rows !== null &&
        Math.max(result.actualRows, result.rows) >= 100 &&
        Math.max(result.actualRows, 1) / Math.max(result.rows, 1) >= 10
    ) {
        result.warnings.push("misestimate");
    }
    if (/external|disk/i.test(str(plan["Sort Method"]) ?? "")) {
        result.warnings.push("diskSort");
    }
    const children = plan["Plans"];
    if (Array.isArray(children)) {
        result.children = children.filter(isObject).map(pgNode);
    }
    return result;
}

const MYSQL_WRAPPERS: Record<string, string> = {
    nested_loop: "Nested Loop",
    ordering_operation: "Sort",
    grouping_operation: "Group",
    duplicates_removal: "Distinct",
    windowing: "Window",
    union_result: "Union",
    materialized_from_subquery: "Materialized subquery",
    attached_subqueries: "Subqueries",
    optimized_away_subqueries: "Subqueries",
    having_subqueries: "Subqueries",
    select_list_subqueries: "Subqueries",
    query_specifications: "Union parts",
    read_sorted_file: "Read sorted file",
    filesort: "Sort",
    temporary_table: "Temporary table",
};

function mysqlChildren(value: Json): PlanNode[] {
    const children: PlanNode[] = [];
    for (const [key, child] of Object.entries(value)) {
        children.push(...mysqlEntry(key, child));
    }
    return children;
}

function mysqlEntry(key: string, value: unknown): PlanNode[] {
    if (key === "query_block" && isObject(value)) {
        return [mysqlBlock(value)];
    }
    if (key === "table" && isObject(value)) {
        return [mysqlTable(value)];
    }
    const title = MYSQL_WRAPPERS[key];
    if (!title) {
        return [];
    }
    const wrapper = node(title);
    if (Array.isArray(value)) {
        for (const item of value) {
            if (isObject(item)) {
                wrapper.children.push(...mysqlChildren(item));
            }
        }
    } else if (isObject(value)) {
        if (value["using_filesort"] === true) {
            wrapper.warnings.push("filesort");
        }
        if (value["using_temporary_table"] === true) {
            wrapper.warnings.push("temporary");
        }
        wrapper.children = mysqlChildren(value);
    }
    if (key === "nested_loop" || key === "query_specifications") {
        return wrapper.children.length === 1 ? wrapper.children : [wrapper];
    }
    return [wrapper];
}

function mysqlBlock(block: Json): PlanNode {
    const result = node(
        `Query block ${str(block["select_id"]) ?? num(block["select_id"]) ?? ""}`.trim(),
    );
    const costInfo = isObject(block["cost_info"]) ? block["cost_info"] : {};
    result.cost = num(costInfo["query_cost"]) ?? num(block["cost"]);
    detail(result, "Message", block["message"]);
    result.children = mysqlChildren(block);
    return result;
}

function mysqlTable(table: Json): PlanNode {
    const access = str(table["access_type"]) ?? "?";
    const result = node(access, str(table["table_name"]));
    detail(result, "Key", table["key"]);
    detail(result, "Possible keys", table["possible_keys"]);
    detail(result, "Ref", table["ref"]);
    detail(result, "Condition", table["attached_condition"]);
    detail(result, "Index condition", table["index_condition"]);
    detail(result, "Filtered %", table["filtered"]);
    detail(result, "Message", table["message"]);
    result.rows = num(table["rows_examined_per_scan"]) ?? num(table["rows"]);
    const costInfo = isObject(table["cost_info"]) ? table["cost_info"] : {};
    result.cost = num(costInfo["prefix_cost"]) ?? num(table["cost"]);
    result.actualRows = num(table["r_rows"]);
    result.actualMs = num(table["r_total_time_ms"]);
    if (access === "ALL" && (result.rows ?? 0) >= LARGE_SCAN) {
        result.warnings.push("fullScan");
    }
    if (table["using_filesort"] === true) {
        result.warnings.push("filesort");
    }
    if (table["using_temporary_table"] === true) {
        result.warnings.push("temporary");
    }
    for (const [key, child] of Object.entries(table)) {
        result.children.push(...mysqlEntry(key, child));
    }
    return result;
}

export function parsePlan(engine: "mysql" | "postgres", json: string): Plan {
    const value: unknown = JSON.parse(json);
    if (engine === "postgres") {
        const first = Array.isArray(value) ? value[0] : value;
        if (!isObject(first) || !isObject(first["Plan"])) {
            throw new Error("unexpected PostgreSQL plan format");
        }
        return {
            root: pgNode(first["Plan"]),
            planningMs: num(first["Planning Time"]),
            executionMs: num(first["Execution Time"]),
        };
    }
    if (!isObject(value) || !isObject(value["query_block"])) {
        throw new Error("unexpected MySQL plan format");
    }
    return { root: mysqlBlock(value["query_block"]), planningMs: null, executionMs: null };
}

export function countWarnings(plan: PlanNode): number {
    return (
        plan.warnings.length + plan.children.reduce((sum, child) => sum + countWarnings(child), 0)
    );
}
