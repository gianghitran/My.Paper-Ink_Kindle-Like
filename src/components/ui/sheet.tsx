import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

export const Sheet = DialogPrimitive.Root
export const SheetTrigger = DialogPrimitive.Trigger
export const SheetClose = DialogPrimitive.Close

type Side = 'bottom' | 'right' | 'left'

const sideClass: Record<Side, string> = {
  bottom:
    'anim-slide-up inset-x-0 bottom-0 max-h-[88dvh] rounded-t-2xl border-t pb-safe sm:left-1/2 sm:right-auto sm:w-[min(640px,100vw)] sm:-translate-x-1/2 sm:[animation:none]',
  right: 'anim-slide-left inset-y-0 right-0 h-full w-[min(420px,92vw)] border-l pt-safe pb-safe pr-safe',
  left: 'anim-slide-right inset-y-0 left-0 h-full w-[min(360px,88vw)] border-r pt-safe pb-safe pl-safe',
}

export function SheetContent({
  side = 'bottom',
  title,
  description,
  className,
  children,
  headerExtra,
  hideHeader,
  ...props
}: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
  side?: Side
  title: string
  description?: string
  headerExtra?: React.ReactNode
  hideHeader?: boolean
}) {
  const contentRef = React.useRef<HTMLDivElement>(null)
  const closeRef = React.useRef<HTMLButtonElement>(null)
  const drag = React.useRef<{ y: number; dy: number } | null>(null)

  const onHandleDown = (e: React.PointerEvent) => {
    if (side !== 'bottom') return
    drag.current = { y: e.clientY, dy: 0 }
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }
  const onHandleMove = (e: React.PointerEvent) => {
    if (!drag.current || !contentRef.current) return
    drag.current.dy = Math.max(0, e.clientY - drag.current.y)
    contentRef.current.style.transform = `translateY(${drag.current.dy}px)`
  }
  const onHandleUp = () => {
    if (!drag.current || !contentRef.current) return
    const { dy } = drag.current
    drag.current = null
    contentRef.current.style.transform = ''
    if (dy > 90) closeRef.current?.click()
  }

  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="anim-fade-in fixed inset-0 z-50 bg-black/30 eink:bg-black/15" />
      <DialogPrimitive.Content
        ref={contentRef}
        className={cn('fixed z-50 flex flex-col border-border bg-popover text-foreground shadow-2xl outline-none', sideClass[side], className)}
        {...props}
      >
        {side === 'bottom' && (
          <div
            className="flex h-6 shrink-0 cursor-grab touch-none items-center justify-center"
            onPointerDown={onHandleDown}
            onPointerMove={onHandleMove}
            onPointerUp={onHandleUp}
            onPointerCancel={onHandleUp}
            aria-hidden
          >
            <div className="h-1.5 w-10 rounded-full bg-foreground/20" />
          </div>
        )}
        <div className={cn('flex shrink-0 items-center gap-2 px-4 pb-2', side !== 'bottom' && 'pt-3', hideHeader && 'sr-only')}>
          <div className="min-w-0 flex-1">
            <DialogPrimitive.Title className="truncate text-base font-semibold">{title}</DialogPrimitive.Title>
            <DialogPrimitive.Description className={cn('text-[13px] text-muted-foreground', !description && 'sr-only')}>
              {description ?? title}
            </DialogPrimitive.Description>
          </div>
          {headerExtra}
          <DialogPrimitive.Close
            ref={closeRef}
            className="-mr-2 inline-flex size-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted"
            aria-label="Close"
          >
            <X className="size-5" />
          </DialogPrimitive.Close>
        </div>
        <div className="thin-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  )
}
