import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { X } from "lucide-react"

import { cn } from "@/lib/utils"

const tagVariants = cva(
  "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium transition-colors",
  {
    variants: {
      variant: {
        default: "border-border bg-muted/50 text-foreground",
        primary: "border-primary/30 bg-primary/10 text-primary",
        secondary: "border-secondary bg-secondary text-secondary-foreground",
        destructive: "border-destructive/30 bg-destructive/10 text-destructive",
        success: "border-green-500/30 bg-green-500/10 text-green-600 dark:text-green-400",
        warning: "border-yellow-500/30 bg-yellow-500/10 text-yellow-600 dark:text-yellow-400",
        outline: "border-border text-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

interface TagProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof tagVariants> {
  closable?: boolean
  onClose?: (e: React.MouseEvent) => void
  checkable?: boolean
  checked?: boolean
  onCheck?: (checked: boolean) => void
}

function Tag({
  className,
  variant,
  closable,
  onClose,
  checkable,
  checked,
  onCheck,
  children,
  ...props
}: TagProps) {
  if (checkable) {
    return (
      <span
        data-slot="tag"
        role="checkbox"
        aria-checked={checked}
        className={cn(
          "inline-flex cursor-pointer items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium transition-colors select-none",
          checked
            ? "border-primary/30 bg-primary/10 text-primary"
            : "border-transparent bg-transparent text-muted-foreground hover:text-foreground",
          className
        )}
        onClick={() => onCheck?.(!checked)}
        {...props}
      >
        {children}
      </span>
    )
  }

  return (
    <span
      data-slot="tag"
      className={cn(tagVariants({ variant }), className)}
      {...props}
    >
      {children}
      {closable && (
        <button
          type="button"
          className="ml-0.5 rounded-sm opacity-60 hover:opacity-100"
          onClick={(e) => {
            e.stopPropagation()
            onClose?.(e)
          }}
        >
          <X className="size-3" />
        </button>
      )}
    </span>
  )
}

export { Tag, tagVariants }
