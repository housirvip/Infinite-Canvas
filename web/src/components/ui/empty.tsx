import * as React from "react"
import { PackageOpen } from "lucide-react"

import { cn } from "@/lib/utils"

interface EmptyProps extends React.HTMLAttributes<HTMLDivElement> {
  description?: React.ReactNode
  image?: React.ReactNode
}

function Empty({ className, description = "暂无数据", image, ...props }: EmptyProps) {
  return (
    <div
      data-slot="empty"
      className={cn(
        "flex flex-col items-center justify-center gap-2 py-8 text-muted-foreground",
        className
      )}
      {...props}
    >
      {image ?? <PackageOpen className="size-10 opacity-40" />}
      {description && (
        <p className="text-sm">{description}</p>
      )}
    </div>
  )
}

export { Empty }
