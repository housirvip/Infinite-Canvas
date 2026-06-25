import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";

import { cn } from "@/lib/utils";

const sizeOptions = ["auto", "1:1", "3:2", "2:3", "4:3", "3:4", "16:9", "9:16"];

type CanvasSizePickerProps = {
    value: string;
    className?: string;
    onChange: (value: string) => void;
};

export function CanvasSizePicker({ value, className, onChange }: CanvasSizePickerProps) {
    const selectSize = (next: string) => {
        onChange(next.trim());
    };

    return (
        <div className={className}>
            <Select value={value || undefined} onValueChange={selectSize}>
                <SelectTrigger className={cn("canvas-compact-control canvas-control-select h-full w-full")}>
                    <SelectValue placeholder="比例" />
                </SelectTrigger>
                <SelectContent onPointerDown={(event) => event.stopPropagation()}>
                    {sizeOptions.map((size) => (
                        <SelectItem key={size} value={size}>
                            {size}
                        </SelectItem>
                    ))}
                    {value && !sizeOptions.includes(value) ? (
                        <SelectItem value={value}>
                            {value}
                        </SelectItem>
                    ) : null}
                </SelectContent>
            </Select>
        </div>
    );
}
