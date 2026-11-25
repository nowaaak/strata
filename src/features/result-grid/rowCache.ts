import type { Row } from "@/api/query";

export const PAGE_SIZE = 250;
const RANGE_CHUNK = 5000;

type Loader = (offset: number, limit: number) => Promise<Row[]>;

export class RowCache {
    private readonly pages = new Map<number, Row[]>();
    private readonly pending = new Set<number>();
    private readonly listeners = new Set<() => void>();
    private version = 0;
    private readonly load: Loader;
    private readonly onError: (error: unknown) => void;

    constructor(load: Loader, onError: (error: unknown) => void) {
        this.load = load;
        this.onError = onError;
    }

    subscribe = (listener: () => void) => {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    };

    getVersion = () => this.version;

    row(index: number): Row | undefined {
        return this.pages.get(Math.floor(index / PAGE_SIZE))?.[index % PAGE_SIZE];
    }

    ensure(from: number, to: number, rowCount: number) {
        if (rowCount <= 0) {
            return;
        }
        const first = Math.max(0, Math.floor(from / PAGE_SIZE));
        const last = Math.floor(Math.min(to, rowCount - 1) / PAGE_SIZE);
        for (let page = first; page <= last; page += 1) {
            const expected = Math.min(PAGE_SIZE, rowCount - page * PAGE_SIZE);
            const loaded = this.pages.get(page)?.length ?? 0;
            if (loaded < expected && !this.pending.has(page)) {
                this.fetchPage(page);
            }
        }
    }

    async rows(from: number, to: number): Promise<Row[]> {
        const out: Row[] = [];
        for (let offset = from; offset <= to; offset += RANGE_CHUNK) {
            const limit = Math.min(RANGE_CHUNK, to - offset + 1);
            out.push(...(await this.load(offset, limit)));
        }
        return out;
    }

    private fetchPage(page: number) {
        this.pending.add(page);
        this.load(page * PAGE_SIZE, PAGE_SIZE)
            .then((rows) => {
                this.pages.set(page, rows);
                this.version += 1;
                for (const listener of this.listeners) {
                    listener();
                }
            })
            .catch(this.onError)
            .finally(() => this.pending.delete(page));
    }
}
