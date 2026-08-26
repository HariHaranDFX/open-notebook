"use client"

import { ReactNode } from "react"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"

interface FormSectionProps {
  title: string
  description?: string
  children: ReactNode
  className?: string
  contentClassName?: string
  htmlFor?: string
}

export function FormSection({
  title,
  description,
  children,
  className,
  contentClassName,
  htmlFor
}: FormSectionProps) {
  return (
    <div data-slot="form-section" className={cn("mb-6 last:mb-0", className)}>
      <div className="mb-4">
        {htmlFor ? (
          <Label htmlFor={htmlFor} className="text-base font-medium block mb-1">
            {title}
          </Label>
        ) : (
          <h3 className="text-base font-medium block mb-1">
            {title}
          </h3>
        )}
        {description && (
          <p className="text-sm text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      <div data-slot="form-section-content" className={cn("space-y-3", contentClassName)}>
        {children}
      </div>
    </div>
  )
}
