import { forwardRef } from 'react'
import { Contrast, Palette } from 'lucide-react'
import { inkScreenOf, useSettings, withInkScreen, type InkScreen } from '@/store/settings'
import { IconButton } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { Slider } from '@/components/ui/controls'

export const INK_SCREENS: { value: InkScreen; label: string; short: string; hint: string }[] = [
  { value: 'off', label: 'Off', short: 'E-ink', hint: 'Normal screen colours' },
  { value: 'mono', label: 'E-Ink Mono', short: 'Mono', hint: 'Grayscale e-paper' },
  { value: 'color', label: 'E-Ink Color', short: 'Color', hint: 'Kaleido 3-style' },
]

const PillTrigger = forwardRef<HTMLButtonElement, { screen: InkScreen; tabIndex?: number } & React.ButtonHTMLAttributes<HTMLButtonElement>>(
  ({ screen, className, ...props }, ref) => {
    const meta = INK_SCREENS.find((s) => s.value === screen)!
    return (
      <button
        ref={ref}
        type="button"
        aria-label={`E-ink screen: ${meta.label}`}
        title={`E-ink screen: ${meta.label}`}
        className={cn(
          'ml-1 flex min-h-11 items-center gap-1.5 rounded-full px-2.5 text-[12px] font-medium text-muted-foreground hover:bg-muted',
          screen !== 'off' && 'bg-foreground text-background hover:bg-foreground',
          className,
        )}
        {...props}
      >
        {screen === 'color' ? <Palette className="size-[18px]" /> : <Contrast className="size-[18px]" />}
        <span className="hidden sm:inline">{meta.short}</span>
      </button>
    )
  },
)
PillTrigger.displayName = 'PillTrigger'

export function InkModeMenu({ variant, tabIndex }: { variant: 'pill' | 'icon'; tabIndex?: number }) {
  const settings = useSettings((s) => s.settings)
  const update = useSettings((s) => s.update)
  const screen = inkScreenOf(settings.inkFilter)
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        {variant === 'pill' ? (
          <PillTrigger screen={screen} tabIndex={tabIndex} />
        ) : (
          <IconButton label={`E-ink screen: ${INK_SCREENS.find((s) => s.value === screen)!.label}`} active={screen !== 'off'} tabIndex={tabIndex}>
            {screen === 'color' ? <Palette /> : <Contrast />}
          </IconButton>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>E-ink screen</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={screen} onValueChange={(v) => update(withInkScreen(settings, v as InkScreen))}>
          {INK_SCREENS.map((s) => (
            <DropdownMenuRadioItem key={s.value} value={s.value}>
              <span className="flex flex-col">
                {s.label}
                <span className="text-[12px] text-muted-foreground">{s.hint}</span>
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        {screen !== 'off' && <InkToneSlider className="w-64 max-w-full border-t border-border px-2 pb-1 pt-2" />}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

const toneName = (t: number) => (t < 0.08 ? 'White' : t < 0.38 ? 'Light gray' : t < 0.62 ? 'Gray' : t < 0.92 ? 'Dark gray' : 'Black')

const warmthName = (w: number) => (Math.abs(w) < 0.05 ? 'Neutral' : `${w < 0 ? 'Cool' : 'Warm'} ${Math.round(Math.abs(w) * 100)}%`)

export function InkToneSlider({ className }: { className?: string }) {
  const inkFilter = useSettings((s) => s.settings.inkFilter)
  const update = useSettings((s) => s.update)
  const tone = inkFilter.tone
  const warmth = inkFilter.warmth
  return (

    <div className={cn('flex flex-col', className)} onKeyDown={(e) => e.stopPropagation()}>
      <div className="flex items-center justify-between text-[13px]">
        <span>Background</span>
        <span className="tabular-nums text-muted-foreground">
          {toneName(tone)} · {Math.round(tone * 100)}%
        </span>
      </div>
      <Slider
        label="E-ink background, white to black"
        min={0}
        max={1}
        step={0.05}
        value={[tone]}
        onValueChange={([v]) => update({ inkFilter: { ...inkFilter, tone: Math.round(v * 100) / 100 } })}
      />
      <div className="-mt-1 flex justify-between text-[11px] text-muted-foreground" aria-hidden="true">
        <span>White</span>
        <span>Gray</span>
        <span>Black</span>
      </div>
      <div className="mt-2 flex items-center justify-between text-[13px]">
        <span>Light temperature</span>
        <span className="tabular-nums text-muted-foreground">{warmthName(warmth)}</span>
      </div>
      <Slider
        label="E-ink light temperature, cool to warm"
        min={-1}
        max={1}
        step={0.1}
        value={[warmth]}
        onValueChange={([v]) => update({ inkFilter: { ...inkFilter, warmth: Math.round(v * 10) / 10 } })}
      />
      <div className="-mt-1 flex justify-between text-[11px] text-muted-foreground" aria-hidden="true">
        <span>Cool</span>
        <span>Neutral</span>
        <span>Warm</span>
      </div>
    </div>
  )
}
