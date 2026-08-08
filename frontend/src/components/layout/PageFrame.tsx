import * as React from 'react'

import { cn } from '@/lib/utils'

const widthClasses = {
  full: '',
  content: 'max-w-[1600px]',
  reading: 'max-w-3xl',
} as const

interface PageFrameProps extends React.ComponentProps<'div'> {
  width?: keyof typeof widthClasses
}

export function PageFrame({
  width = 'content',
  className,
  children,
  ...props
}: PageFrameProps) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div
        className={cn(
          'mx-auto w-full space-y-6 px-4 py-5 sm:px-6 sm:py-6 lg:px-8',
          widthClasses[width],
          className
        )}
        {...props}
      >
        {children}
      </div>
    </div>
  )
}
