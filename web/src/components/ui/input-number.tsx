import * as React from "react"
import { Minus, Plus } from "lucide-react"

import { cn } from "@/lib/utils"

interface InputNumberProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange" | "value" | "size"> {
  value?: number
  defaultValue?: number
  onChange?: (value: number | null) => void
  min?: number
  max?: number
  step?: number
  size?: "sm" | "default" | "lg"
  controls?: boolean
}

function InputNumber({
  className,
  value,
  defaultValue,
  onChange,
  min,
  max,
  step = 1,
  size = "default",
  controls = true,
  disabled,
  ...props
}: InputNumberProps) {
  const [internalValue, setInternalValue] = React.useState<string>(
    defaultValue !== undefined ? String(defaultValue) : ""
  )

  const displayValue = value !== undefined ? String(value) : internalValue

  const updateValue = (newVal: number | null) => {
    if (newVal !== null) {
      if (min !== undefined && newVal < min) newVal = min
      if (max !== undefined && newVal > max) newVal = max
    }
    setInternalValue(newVal !== null ? String(newVal) : "")
    onChange?.(newVal)
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value
    setInternalValue(raw)
    const num = parseFloat(raw)
    if (!isNaN(num)) {
      onChange?.(num)
    } else if (raw === "") {
      onChange?.(null)
    }
  }

  const increment = () => {
    const current = parseFloat(displayValue) || 0
    updateValue(current + step)
  }

  const decrement = () => {
    const current = parseFloat(displayValue) || 0
    updateValue(current - step)
  }

  return (
    <div
      data-slot="input-number"
      className={cn(
        "inline-flex items-center rounded-lg border border-input bg-background",
        size === "sm" && "h-7",
        size === "default" && "h-8",
        size === "lg" && "h-9",
        disabled && "opacity-50",
        className
      )}
    >
      {controls && (
        <button
          type="button"
          disabled={disabled || (min !== undefined && parseFloat(displayValue) <= min)}
          className="flex h-full items-center px-1.5 text-muted-foreground hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
          onClick={decrement}
        >
          <Minus className="size-3" />
        </button>
      )}
      <input
        type="text"
        inputMode="numeric"
        disabled={disabled}
        value={displayValue}
        onChange={handleInputChange}
        className={cn(
          "h-full w-12 border-none bg-transparent text-center text-sm outline-none",
          !controls && "w-full px-2 text-left"
        )}
        {...props}
      />
      {controls && (
        <button
          type="button"
          disabled={disabled || (max !== undefined && parseFloat(displayValue) >= max)}
          className="flex h-full items-center px-1.5 text-muted-foreground hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
          onClick={increment}
        >
          <Plus className="size-3" />
        </button>
      )}
    </div>
  )
}

export { InputNumber }
