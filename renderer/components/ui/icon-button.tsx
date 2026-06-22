import * as React from 'react'

import { cn } from '@/lib/utils'

type IconButtonTone = 'default' | 'primary' | 'danger'

const toneClasses: Record<IconButtonTone, string> = {
  default: 'text-muted-foreground hover:bg-accent hover:text-foreground',
  primary: 'text-muted-foreground hover:bg-accent hover:text-primary',
  danger: 'text-muted-foreground hover:bg-destructive/15 hover:text-destructive',
}

export interface IconButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  'aria-label': string
  children: React.ReactNode
  tone?: IconButtonTone
}

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ className, children, tone = 'default', type = 'button', ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-md p-1.5 transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none',
        toneClasses[tone],
        className
      )}
      {...props}
    >
      {children}
    </button>
  )
)

IconButton.displayName = 'IconButton'
