import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

export const buttonVariants = cva(
  'inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-45 [&_svg]:pointer-events-none [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:opacity-90 active:opacity-80',
        secondary: 'bg-muted text-foreground hover:bg-accent active:bg-accent',
        outline: 'border border-border bg-transparent hover:bg-muted active:bg-accent',
        ghost: 'bg-transparent hover:bg-muted active:bg-accent',
        destructive: 'bg-destructive text-white hover:opacity-90',
        link: 'h-auto min-h-0 px-0 underline-offset-4 hover:underline',
      },
      size: {
        default: 'min-h-11 px-4 [&_svg]:size-[18px]',
        sm: 'min-h-9 px-3 text-[13px] [&_svg]:size-4 pointer-coarse:min-h-11',
        lg: 'min-h-12 px-6 text-base [&_svg]:size-5',
        icon: 'size-11 [&_svg]:size-5',
        'icon-sm': 'size-9 [&_svg]:size-[18px] pointer-coarse:size-11',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
)

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, type = 'button', ...props }, ref) => (
  <button ref={ref} type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />
))
Button.displayName = 'Button'

export const IconButton = React.forwardRef<HTMLButtonElement, ButtonProps & { label: string; active?: boolean }>(
  ({ label, active, className, variant = 'ghost', size = 'icon', ...props }, ref) => (
    <Button
      ref={ref}
      aria-label={label}
      title={label}
      aria-pressed={active === undefined ? undefined : active}
      variant={variant}
      size={size}
      className={cn(active && 'bg-muted', className)}
      {...props}
    />
  ),
)
IconButton.displayName = 'IconButton'
