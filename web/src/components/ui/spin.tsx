import * as React from "react"
import { Loader2 } from "lucide-react"

import { cn } from "@/lib/utils"

interface SpinProps extends React.HTMLAttributes<HTMLDivElement> {
  spinning?: boolean
  size?: "sm" | "default" | "lg"
  tip?: React.ReactNode
}

function Spin({
  className,
  spinning = true,
  size = "default",
  tip,
  children,
  ...props
}: SpinProps) {
  const iconSize = size === "sm" ? "size-4" : size === "lg" ? "size-8" : "size-5"

  if (children) {
    return (
      <div data-slot="spin" className={cn("relative", className)} {...props}>
        {children}
        {spinning && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 rounded-md bg-background/60">
            <Loader2 className={cn(iconSize, "animate-spin text-primary")} />
            {tip && <span className="text-sm text-muted-foreground">{tip}</span>}
          </div>
        )}
      </div>
    )
  }

  if (!spinning) return null

  return (
    <div
      data-slot="spin"
      className={cn("flex flex-col items-center justify-center gap-2", className)}
      {...props}
    >
      <Loader2 className={cn(iconSize, "animate-spin text-primary")} />
      {tip && <span className="text-sm text-muted-foreground">{tip}</span>}
    </div>
  )
}

export { Spin }
