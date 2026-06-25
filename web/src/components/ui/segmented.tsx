import * as React from "react"

import { cn } from "@/lib/utils"

interface SegmentedOption<T extends string | number = string> {
  label: React.ReactNode
  value: T
  icon?: React.ReactNode
  disabled?: boolean
}

interface SegmentedProps<T extends string | number = string>
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "onChange"> {
  options: (T | SegmentedOption<T>)[]
  value?: T
  defaultValue?: T
  onChange?: (value: T) => void
  size?: "sm" | "default" | "lg"
  block?: boolean
}

function Segmented<T extends string | number = string>({
  className,
  options,
  value,
  defaultValue,
  onChange,
  size = "default",
  block,
  ...props
}: SegmentedProps<T>) {
  const [internalValue, setInternalValue] = React.useState<T | undefined>(defaultValue)
  const currentValue = value ?? internalValue

  const normalizedOptions: SegmentedOption<T>[] = options.map((opt) =>
    typeof opt === "object" && opt !== null && "value" in opt
      ? (opt as SegmentedOption<T>)
      : { label: String(opt), value: opt as T }
  )

  const handleSelect = (val: T) => {
    setInternalValue(val)
    onChange?.(val)
  }

  return (
    <div
      data-slot="segmented"
      className={cn(
        "inline-flex items-center gap-0.5 rounded-lg bg-muted p-0.5",
        block && "flex w-full",
        className
      )}
      {...props}
    >
      {normalizedOptions.map((opt) => (
        <button
          key={String(opt.value)}
          type="button"
          disabled={opt.disabled}
          className={cn(
            "inline-flex items-center justify-center gap-1.5 rounded-md px-3 font-medium whitespace-nowrap transition-all select-none",
            size === "sm" && "h-6 text-xs px-2",
            size === "default" && "h-7 text-sm",
            size === "lg" && "h-8 text-sm",
            block && "flex-1",
            currentValue === opt.value
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
            opt.disabled && "pointer-events-none opacity-50"
          )}
          onClick={() => handleSelect(opt.value)}
        >
          {opt.icon}
          {opt.label}
        </button>
      ))}
    </div>
  )
}

export { Segmented, type SegmentedOption, type SegmentedProps }
