import * as React from 'react'
import * as SliderPrimitive from '@radix-ui/react-slider'
import * as SwitchPrimitive from '@radix-ui/react-switch'
import * as TabsPrimitive from '@radix-ui/react-tabs'
import { cn } from '@/lib/utils'

export function Slider({ className, label, ...props }: React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root> & { label: string }) {
  return (
    <SliderPrimitive.Root className={cn('relative flex h-11 w-full touch-none select-none items-center', className)} {...props}>
      <SliderPrimitive.Track className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-foreground/15">
        <SliderPrimitive.Range className="absolute h-full bg-foreground/70" />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb
        aria-label={label}
        className="block size-6 rounded-full border-2 border-foreground/70 bg-card shadow focus-visible:outline-2 focus-visible:outline-ring"
      />
    </SliderPrimitive.Root>
  )
}

export function Switch({ className, ...props }: React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        'relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border border-border bg-foreground/15 transition-colors data-[state=checked]:bg-primary',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="block size-5 translate-x-1 rounded-full bg-card shadow transition-transform data-[state=checked]:translate-x-6" />
    </SwitchPrimitive.Root>
  )
}

export const Tabs = TabsPrimitive.Root

export function TabsList({ className, ...props }: React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>) {
  return <TabsPrimitive.List className={cn('flex shrink-0 gap-1 rounded-xl bg-muted p-1', className)} {...props} />
}

export function TabsTrigger({ className, ...props }: React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        'flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-lg px-2 text-[13px] font-medium text-muted-foreground data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-sm pointer-coarse:min-h-11 [&_svg]:size-4',
        className,
      )}
      {...props}
    />
  )
}

export const TabsContent = TabsPrimitive.Content

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className,
  label,
}: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: React.ReactNode; title?: string }[]
  className?: string
  label: string
}) {
  return (
    <div role="radiogroup" aria-label={label} className={cn('flex gap-1 rounded-xl bg-muted p-1', className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={cn(
            'flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-lg px-2 text-[13px] font-medium text-muted-foreground pointer-coarse:min-h-11 [&_svg]:size-4',
            value === o.value && 'bg-card text-foreground shadow-sm eink:outline eink:outline-1 eink:outline-black',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Badge({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn('inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground', className)}
      {...props}
    />
  )
}

export function ProgressBar({ value, className }: { value: number; className?: string }) {
  return (
    <div className={cn('h-1 w-full overflow-hidden rounded-full bg-foreground/10', className)} role="progressbar" aria-valuenow={Math.round(value * 100)} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-full rounded-full bg-foreground/60" style={{ width: `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%` }} />
    </div>
  )
}

export function EmptyState({ icon, title, children, className }: { icon: React.ReactNode; title: string; children?: React.ReactNode; className?: string }) {
  return (
    <div className={cn('mx-auto flex max-w-sm flex-col items-center px-6 py-16 text-center', className)}>
      <div className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground [&_svg]:size-7">{icon}</div>
      <h2 className="text-lg font-semibold">{title}</h2>
      {children && <div className="mt-2 text-sm text-muted-foreground">{children}</div>}
    </div>
  )
}
