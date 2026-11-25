import { PAGE_SIZE, RowCache } from "./rowCache";

function loader() {
    const calls: [number, number][] = [];
    let available = 1000;
    const load = (offset: number, limit: number) => {
        calls.push([offset, limit]);
        const end = Math.min(available, offset + limit);
        return Promise.resolve(
            Array.from({ length: Math.max(0, end - offset) }, (_, i) => [String(offset + i)]),
        );
    };
    return { calls, load, grow: (rows: number) => (available = rows) };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("RowCache", () => {
    it("loads only the pages of the requested range once", async () => {
        const { calls, load } = loader();
        const cache = new RowCache(load, () => undefined);
        cache.ensure(240, 260, 1000);
        cache.ensure(240, 260, 1000);
        await flush();
        expect(calls).toEqual([
            [0, PAGE_SIZE],
            [PAGE_SIZE, PAGE_SIZE],
        ]);
        expect(cache.row(255)).toEqual(["255"]);
        cache.ensure(0, 10, 1000);
        await flush();
        expect(calls).toHaveLength(2);
    });

    it("refetches a partial page while results are still streaming", async () => {
        const { calls, load, grow } = loader();
        grow(100);
        const cache = new RowCache(load, () => undefined);
        cache.ensure(0, 99, 100);
        await flush();
        expect(cache.row(99)).toEqual(["99"]);
        grow(300);
        cache.ensure(0, 200, 300);
        await flush();
        expect(calls[1]).toEqual([0, PAGE_SIZE]);
        expect(cache.row(200)).toEqual(["200"]);
    });

    it("notifies subscribers and reports load errors", async () => {
        const errors: unknown[] = [];
        const cache = new RowCache(
            () => Promise.reject(new Error("gone")),
            (error) => errors.push(error),
        );
        let notified = 0;
        cache.subscribe(() => (notified += 1));
        cache.ensure(0, 1, 2);
        await flush();
        expect(notified).toBe(0);
        expect(errors).toHaveLength(1);
    });
});
