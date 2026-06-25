"use client"

import * as React from "react"
import { X, ChevronsUpDown, Check } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

interface MultiSelectProps {
  options: string[]
  value: string[]
  onChange: (value: string[]) => void
  placeholder?: string
  searchPlaceholder?: string
  emptyText?: string
  className?: string
  allowCustom?: boolean
}

function MultiSelect({
  options,
  value,
  onChange,
  placeholder = "请选择...",
  searchPlaceholder = "搜索...",
  emptyText = "无匹配项",
  className,
  allowCustom = true,
}: MultiSelectProps) {
  const [open, setOpen] = React.useState(false)
  const [search, setSearch] = React.useState("")

  const handleSelect = (item: string) => {
    if (value.includes(item)) {
      onChange(value.filter((v) => v !== item))
    } else {
      onChange([...value, item])
    }
  }

  const handleRemove = (item: string, e: React.MouseEvent) => {
    e.stopPropagation()
    onChange(value.filter((v) => v !== item))
  }

  const handleAddCustom = () => {
    const trimmed = search.trim()
    if (trimmed && !value.includes(trimmed)) {
      onChange([...value, trimmed])
      setSearch("")
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && allowCustom && search.trim() && !options.includes(search.trim())) {
      e.preventDefault()
      handleAddCustom()
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn("h-auto min-h-8 w-full justify-between font-normal", className)}
        >
          <div className="flex flex-1 flex-wrap items-center gap-1">
            {value.length === 0 && (
              <span className="text-muted-foreground">{placeholder}</span>
            )}
            {value.map((item) => (
              <span
                key={item}
                className="inline-flex items-center gap-0.5 rounded-md bg-secondary px-1.5 py-0.5 text-xs"
              >
                <span className="max-w-[140px] truncate">{item}</span>
                <button
                  type="button"
                  className="ml-0.5 rounded-sm opacity-60 hover:opacity-100"
                  onClick={(e) => handleRemove(item, e)}
                  onPointerDown={(e) => e.stopPropagation()}
                >
                  <X className="size-3" />
                </button>
              </span>
            ))}
          </div>
          <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command shouldFilter={true} onKeyDown={handleKeyDown}>
          <CommandInput
            placeholder={searchPlaceholder}
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            <CommandEmpty>
              {allowCustom && search.trim() ? (
                <button
                  type="button"
                  className="w-full text-sm text-muted-foreground hover:text-foreground"
                  onClick={handleAddCustom}
                >
                  添加 &ldquo;{search.trim()}&rdquo;
                </button>
              ) : (
                emptyText
              )}
            </CommandEmpty>
            <CommandGroup>
              {options.map((option) => (
                <CommandItem
                  key={option}
                  value={option}
                  data-checked={value.includes(option)}
                  onSelect={() => handleSelect(option)}
                >
                  <Check
                    className={cn(
                      "size-4",
                      value.includes(option) ? "opacity-100" : "opacity-0"
                    )}
                  />
                  <span className="truncate">{option}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

export { MultiSelect }
