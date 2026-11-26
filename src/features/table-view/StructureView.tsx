import { KeyRoundIcon, PencilRulerIcon } from "lucide-react";
import type { TableInfo } from "@/bindings/TableInfo";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n";

export function StructureView({ info, onEdit }: { info: TableInfo; onEdit?: () => void }) {
    const t = useT();
    const text = t.table.structure;
    const primary = new Set(info.keys.find((key) => key.primary)?.columns ?? []);

    return (
        <div className="h-full overflow-auto p-4">
            {onEdit && (
                <div className="mb-3 flex justify-end">
                    <Button size="sm" variant="outline" onClick={onEdit}>
                        <PencilRulerIcon />
                        {t.designer.menuEdit}
                    </Button>
                </div>
            )}
            <table className="w-full text-[12.5px]">
                <caption className="pb-2 text-left text-[0.6875rem] font-semibold tracking-wider text-muted-foreground uppercase">
                    {text.columns}
                </caption>
                <thead className="text-left text-muted-foreground">
                    <tr>
                        <th className="w-6 py-1.5 font-medium" aria-label={text.key} />
                        <th className="py-1.5 pr-4 font-medium">{text.name}</th>
                        <th className="py-1.5 pr-4 font-medium">{text.type}</th>
                        <th className="py-1.5 pr-4 font-medium">{text.nullable}</th>
                        <th className="py-1.5 pr-4 font-medium">{text.default}</th>
                        <th className="py-1.5 font-medium">{text.extra}</th>
                    </tr>
                </thead>
                <tbody>
                    {info.columns.map((column) => (
                        <tr key={column.name} className="border-t">
                            <td className="py-1.5">
                                {primary.has(column.name) && (
                                    <KeyRoundIcon
                                        className="size-3.5 text-amber-500"
                                        aria-label={text.primaryKey}
                                    />
                                )}
                            </td>
                            <td className="py-1.5 pr-4 font-medium select-text">{column.name}</td>
                            <td className="py-1.5 pr-4 font-mono text-[12px] text-muted-foreground select-text">
                                {column.dataType}
                            </td>
                            <td className="py-1.5 pr-4">{column.nullable ? text.yes : text.no}</td>
                            <td className="max-w-64 truncate py-1.5 pr-4 font-mono text-[12px] select-text">
                                {column.default ?? (
                                    <span className="text-muted-foreground/60">–</span>
                                )}
                            </td>
                            <td className="py-1.5 text-muted-foreground">{column.extra}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
            <h3 className="pt-6 pb-2 text-[0.6875rem] font-semibold tracking-wider text-muted-foreground uppercase">
                {text.uniqueKeys}
            </h3>
            {info.keys.length === 0 ? (
                <p className="rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground">
                    {text.noKeys}
                </p>
            ) : (
                <ul className="flex flex-col gap-1 text-[12.5px]">
                    {info.keys.map((key) => (
                        <li key={key.name} className="flex items-center gap-2">
                            <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium">
                                {key.primary ? "PRIMARY" : "UNIQUE"}
                            </span>
                            <span className="font-medium select-text">{key.name}</span>
                            <span className="font-mono text-muted-foreground select-text">
                                ({key.columns.join(", ")})
                            </span>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
