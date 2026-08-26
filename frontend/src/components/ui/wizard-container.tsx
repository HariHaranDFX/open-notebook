"use client"

import { ReactNode } from "react"
import { CheckIcon } from "lucide-react"
import { cn } from "@/lib/utils"

interface WizardStep {
  number: number
  title: string
  description: string
}

interface WizardContainerProps {
  children: ReactNode
  currentStep: number
  steps: readonly WizardStep[]
  onStepClick?: (step: number) => void
  className?: string
}

function StepIndicator({ currentStep, steps, onStepClick }: {
  currentStep: number
  steps: readonly WizardStep[]
  onStepClick?: (step: number) => void
}) {
  return (
    <div
      data-slot="wizard-steps"
      className="flex items-center justify-between border-b border-border bg-muted px-4 py-3 sm:px-6"
    >
      {steps.map((step, index) => {
        const isCompleted = currentStep > step.number
        const isCurrent = currentStep === step.number
        const isClickable = step.number <= currentStep && onStepClick
        
        return (
          <div key={step.number} className="flex min-w-0 flex-1 items-center">
            <div 
              className={cn('flex min-w-0 items-center gap-2', isClickable && 'cursor-pointer')}
              onClick={isClickable ? () => onStepClick(step.number) : undefined}
            >
              <div
                className={cn(
                  'flex size-7 shrink-0 items-center justify-center rounded-full border-2 text-xs font-medium tabular-nums transition-colors',
                  isCompleted 
                    ? 'bg-primary border-primary text-primary-foreground' 
                    : isCurrent 
                      ? 'border-primary text-primary bg-primary/10'
                      : 'border-border text-muted-foreground bg-card'
                )}
              >
                {isCompleted ? <CheckIcon aria-hidden="true" className="size-4" /> : step.number}
              </div>
              <div className="min-w-0 flex-1">
                <p className={cn(
                  'truncate text-sm font-medium leading-5',
                  isCurrent ? 'text-foreground' : 'text-muted-foreground'
                )}>
                  {step.title}
                </p>
                <p className={cn(
                  'hidden truncate text-xs leading-4 sm:block',
                  isCurrent ? 'text-muted-foreground' : 'text-muted-foreground/80'
                )}>
                  {step.description}
                </p>
              </div>
            </div>
            {index < steps.length - 1 && (
              <div 
                className={cn(
                  'mx-3 flex-1 border-t-2 transition-colors',
                  isCompleted ? 'border-primary' : 'border-border/60'
                )} 
              />
            )}
          </div>
        )
      })}
    </div>
  )
}

export function WizardContainer({
  children,
  currentStep,
  steps,
  onStepClick,
  className
}: WizardContainerProps) {
  return (
    <div className={cn('flex h-[500px] min-w-0 flex-col overflow-hidden rounded-[var(--surface-radius)] border border-border bg-card', className)}>
      <StepIndicator
        currentStep={currentStep}
        steps={steps}
        onStepClick={onStepClick}
      />

      <div className="flex-1 min-w-0 overflow-hidden">
        <div className="h-full min-w-0 overflow-y-auto px-6 py-4">
          {children}
        </div>
      </div>
    </div>
  )
}

export type { WizardStep }
