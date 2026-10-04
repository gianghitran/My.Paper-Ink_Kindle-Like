import * as React from 'react'
import * as Menu from '@radix-ui/react-dropdown-menu'
import { cn } from '@/lib/utils'

export const DropdownMenu = Menu.Root
export const DropdownMenuTrigger = Menu.Trigger

export function DropdownMenuContent({ className, sideOffset = 6, ...props }: React.ComponentPropsWithoutRef<typeof Menu.Content>) {
  return (
    <Menu.Portal>
      <Menu.Content
        sideOffset={sideOffset}
        collisionPadding={8}
        className={cn(
          'anim-fade-in z-50 min-w-[13rem] max-w-[calc(100vw-1rem)] overflow-hidden rounded-xl border border-border bg-popover p-1 text-foreground shadow-xl',
          className,
        )}
        {...props}
      />
    </Menu.Portal>
  )
}

export function DropdownMenuItem({
  className,
  destructive,
  ...props
}: React.ComponentPropsWithoutRef<typeof Menu.Item> & { destructive?: boolean }) {
  return (
    <Menu.Item
      className={cn(
        'flex min-h-11 cursor-pointer select-none items-center gap-3 rounded-lg px-3 text-sm outline-none data-[disabled]:pointer-events-none data-[highlighted]:bg-muted data-[disabled]:opacity-50 [&_svg]:size-[18px] [&_svg]:shrink-0 [&_svg]:text-muted-foreground',
        destructive && 'text-destructive [&_svg]:text-destructive',
        className,
      )}
      {...props}
    />
  )
}

export function DropdownMenuSeparator({ className }: { className?: string }) {
  return <Menu.Separator className={cn('my-1 h-px bg-border', className)} />
}

export function DropdownMenuLabel({ className, ...props }: React.ComponentPropsWithoutRef<typeof Menu.Label>) {
  return <Menu.Label className={cn('px-3 py-1.5 text-xs font-medium text-muted-foreground', className)} {...props} />
}

export const DropdownMenuRadioGroup = Menu.RadioGroup

export function DropdownMenuRadioItem({ className, children, ...props }: React.ComponentPropsWithoutRef<typeof Menu.RadioItem>) {
  return (
    <Menu.RadioItem
      className={cn(
        'flex min-h-11 cursor-pointer select-none items-center gap-3 rounded-lg px-3 text-sm outline-none data-[highlighted]:bg-muted',
        className,
      )}
      {...props}
    >
      <span className="flex size-4 items-center justify-center">
        <Menu.ItemIndicator>
          <span className="block size-2 rounded-full bg-foreground" />
        </Menu.ItemIndicator>
      </span>
      {children}
    </Menu.RadioItem>
  )
}
