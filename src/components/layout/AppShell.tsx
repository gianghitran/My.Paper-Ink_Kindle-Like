import { Suspense, useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import {
  BookMarked,
  BookOpen,
  CheckCircle2,
  ChevronsLeft,
  LogOut,
  ChevronsRight,
  Circle,
  Clock,
  File,
  FileText,
  Shapes,
  BarChart3,
  Languages,
  Library,
  Network,
  NotebookPen,
  Settings,
  Star,
  Upload,
} from 'lucide-react'
import { useViewport } from '@/hooks/useViewport'
import { useSettings } from '@/store/settings'
import { useImport } from '@/hooks/useImport'
import { ImportButton } from '@/components/ImportButton'
import { cn } from '@/lib/utils'
import { Spinner } from '@/components/Spinner'
import { SyncStatus } from '@/components/SyncStatus'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { accountLabel, useAuth } from '@/lib/services/auth'
import { signOutEverywhere } from '@/lib/cloud/session'

export const SHELVES = [
  { id: 'all', label: 'All', icon: Library },
  { id: 'papers', label: 'Papers', icon: FileText },
  { id: 'books', label: 'Books', icon: BookMarked },
  { id: 'documents', label: 'Documents', icon: File },
  { id: 'others', label: 'Others', icon: Shapes },
  { id: 'recent', label: 'Recently Read', icon: Clock },
  { id: 'favorites', label: 'Favorites', icon: Star },
  { id: 'unread', label: 'Unread', icon: Circle },
  { id: 'finished', label: 'Finished', icon: CheckCircle2 },
] as const
export type ShelfId = (typeof SHELVES)[number]['id']

const MAIN_NAV = [
  { to: '/', label: 'Library', icon: BookOpen },
  { to: '/notes', label: 'Notes', icon: NotebookPen },
  { to: '/graph', label: 'Graph', icon: Network },
  { to: '/stats', label: 'Stats', icon: BarChart3 },
  { to: '/vocabulary', label: 'Vocabulary', short: 'Words', icon: Languages },
  { to: '/settings', label: 'Settings', icon: Settings },
]

const PHONE_NAV = MAIN_NAV

function Logo({ compact }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5 px-2">
      <img src="./favicon.svg" alt="" className="size-8 rounded-lg" />
      {!compact && <span className="font-serif text-xl font-semibold tracking-tight">PaperInk</span>}
    </div>
  )
}


function AccountFooter({ collapsed }: { collapsed: boolean }) {
  const user = useAuth((s) => s.user)
  const navigate = useNavigate()
  if (!user) return null
  const signOut = async () => {
    await signOutEverywhere()
    navigate('/login', { replace: true })
  }
  if (collapsed) {
    return (
      <div className="flex flex-col items-center gap-1 border-t border-border py-2">
        <SyncStatus compact />
        <button type="button" onClick={() => void signOut()} aria-label="Sign out" title="Sign out" className="flex size-11 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted">
          <LogOut className="size-[18px]" />
        </button>
      </div>
    )
  }
  return (
    <div className="flex items-center gap-2 border-t border-border px-3 py-2">
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium" title={accountLabel(user)}>
          {accountLabel(user)}
        </p>
        <SyncStatus />
      </div>
      <button type="button" onClick={() => void signOut()} aria-label="Sign out" title="Sign out" className="flex size-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted">
        <LogOut className="size-[18px]" />
      </button>
    </div>
  )
}

function Sidebar() {
  const collapsed = useSettings((s) => s.settings.sidebarCollapsed)
  const update = useSettings((s) => s.update)
  const location = useLocation()
  const [params] = useSearchParams()
  const shelf = params.get('shelf') ?? 'all'
  const onLibrary = location.pathname === '/'

  const itemCls = (active: boolean) =>
    cn(
      'flex min-h-10 items-center gap-3 rounded-lg px-3 text-[14px] text-muted-foreground hover:bg-muted hover:text-foreground pointer-coarse:min-h-11 [&_svg]:size-[18px] [&_svg]:shrink-0',
      active && 'bg-muted font-medium text-foreground eink:outline eink:outline-1 eink:outline-black',
      collapsed && 'justify-center px-0',
    )

  return (
    <aside
      className={cn(
        'flex h-full shrink-0 flex-col border-r border-border bg-card/60 pt-safe pl-safe transition-[width]',
        collapsed ? 'w-[72px]' : 'w-64',
      )}
    >
      <div className={cn('flex h-14 items-center', collapsed ? 'justify-center' : 'justify-between pr-2 pl-2')}>
        <Logo compact={collapsed} />
      </div>
      <div className={cn('px-3 pb-2', collapsed && 'flex justify-center')}>
        <ImportButton compact={collapsed} className={cn(!collapsed && 'w-full')} label="Import documents" />
      </div>
      <nav className="thin-scroll flex-1 overflow-y-auto px-3 py-2" aria-label="Main">
        <NavLink to="/" end className={() => itemCls(onLibrary && shelf === 'all')} title="Library">
          <BookOpen />
          {!collapsed && <span>Library</span>}
        </NavLink>
        {!collapsed && (
          <div className="mb-2 mt-1 ml-3 border-l border-border pl-2">
            {SHELVES.slice(1).map((s) => (
              <NavLink key={s.id} to={`/?shelf=${s.id}`} className={() => itemCls(onLibrary && shelf === s.id)}>
                <s.icon />
                <span>{s.label}</span>
              </NavLink>
            ))}
          </div>
        )}
        {MAIN_NAV.slice(1).map((n) => (
          <NavLink key={n.to} to={n.to} className={({ isActive }) => itemCls(isActive)} title={n.label}>
            <n.icon />
            {!collapsed && <span>{n.label}</span>}
          </NavLink>
        ))}
      </nav>
      <AccountFooter collapsed={collapsed} />
      <div className={cn('border-t border-border p-3 pb-safe', collapsed && 'flex justify-center')}>
        <button
          type="button"
          onClick={() => update({ sidebarCollapsed: !collapsed })}
          className={cn(itemCls(false), 'w-full')}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <ChevronsRight /> : <ChevronsLeft />}
          {!collapsed && <span>Collapse</span>}
        </button>
      </div>
    </aside>
  )
}

function NavRail() {
  return (
    <aside className="flex h-full w-[76px] shrink-0 flex-col items-center gap-1 border-r border-border bg-card/60 pt-safe pl-safe">
      <div className="flex h-16 items-center">
        <img src="./favicon.svg" alt="PaperInk" className="size-9 rounded-lg" />
      </div>
      <ImportButton compact label="Import documents" className="mb-3" />
      {MAIN_NAV.map((n) => (
        <NavLink
          key={n.to}
          to={n.to}
          end={n.to === '/'}
          className={({ isActive }) =>
            cn(
              'flex w-16 flex-col items-center gap-1 rounded-xl py-2 text-[11px] text-muted-foreground [&_svg]:size-[22px]',
              isActive && 'bg-muted font-medium text-foreground eink:outline eink:outline-1 eink:outline-black',
            )
          }
          title={n.label}
        >
          <n.icon />
          {'short' in n ? n.short : n.label}
        </NavLink>
      ))}
    </aside>
  )
}

function BottomNav() {
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 pb-safe backdrop-blur supports-[backdrop-filter]:bg-card/85"
      aria-label="Main"
    >
      <div className="mx-auto flex h-[var(--bottom-nav-h)] max-w-lg items-stretch justify-around px-1">
        {PHONE_NAV.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.to === '/'}
            className={({ isActive }) =>
              cn(
                'flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] text-muted-foreground [&_svg]:size-[22px]',
                isActive && 'font-semibold text-foreground',
              )
            }
          >
            <n.icon />
            <span className="max-w-full truncate">{'short' in n ? n.short : n.label}</span>
          </NavLink>
        ))}
      </div>
    </nav>
  )
}


function DropOverlay() {
  const [active, setActive] = useState(false)
  const depth = useRef(0)
  const { importFiles } = useImport()

  useEffect(() => {
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files')
    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      depth.current++
      setActive(true)
    }
    const onOver = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
    }
    const onLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return
      depth.current = Math.max(0, depth.current - 1)
      if (depth.current === 0) setActive(false)
    }
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      depth.current = 0
      setActive(false)
      void importFiles(e.dataTransfer?.files)
    }
    window.addEventListener('dragenter', onEnter)
    window.addEventListener('dragover', onOver)
    window.addEventListener('dragleave', onLeave)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragenter', onEnter)
      window.removeEventListener('dragover', onOver)
      window.removeEventListener('dragleave', onLeave)
      window.removeEventListener('drop', onDrop)
    }
  }, [importFiles])

  if (!active) return null
  return (
    <div className="anim-fade-in pointer-events-none fixed inset-0 z-[60] flex items-center justify-center bg-background/80 p-6">
      <div className="flex w-full max-w-md flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-foreground/40 bg-card px-8 py-12 text-center">
        <Upload className="size-10 text-muted-foreground" />
        <p className="text-lg font-semibold">Drop documents to import</p>
        <p className="text-sm text-muted-foreground">Files are stored privately in your account.</p>
      </div>
    </div>
  )
}

export function PageFallback() {
  return (
    <div className="flex h-full min-h-[40vh] items-center justify-center">
      <Spinner />
    </div>
  )
}

export function AppShell() {
  const { tier } = useViewport()
  const location = useLocation()
  const inReader = location.pathname.startsWith('/read/')
  const showBottomNav = tier === 'phone' && !inReader

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-background">
      {!inReader && tier === 'wide' && <Sidebar />}
      {!inReader && tier === 'tablet' && <NavRail />}
      <main
        className={cn('relative flex min-w-0 flex-1 flex-col', showBottomNav && 'pb-[calc(var(--bottom-nav-h)+var(--safe-bottom))]')}
      >
        <ErrorBoundary resetKey={location.pathname}>
          <Suspense fallback={<PageFallback />}>
            <Outlet />
          </Suspense>
        </ErrorBoundary>
      </main>
      {showBottomNav && <BottomNav />}
      <DropOverlay />
    </div>
  )
}
