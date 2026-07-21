// Generic data table: sorting, client pagination, empty state, row click.
import { clsx } from 'clsx'
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Inbox } from 'lucide-react'
import { ReactNode, useMemo, useState } from 'react'
import { EmptyState } from './ui'

export interface Column<T> {
  key: string
  header: ReactNode
  render: (row: T) => ReactNode
  sortValue?: (row: T) => number | string
  align?: 'left' | 'right' | 'center'
  className?: string
  hideBelow?: 'sm' | 'md' | 'lg' | 'xl'
}

const HIDE_CLS = {
  sm: 'hidden sm:table-cell',
  md: 'hidden md:table-cell',
  lg: 'hidden lg:table-cell',
  xl: 'hidden xl:table-cell',
}

export function DataTable<T>({
  columns, rows, rowKey, onRowClick, pageSize = 12, emptyTitle = 'Nothing here', emptyMessage = 'No rows match the current filters.',
  defaultSort, defaultDir = 'desc', dense,
}: {
  columns: Column<T>[]
  rows: T[]
  rowKey: (row: T) => string
  onRowClick?: (row: T) => void
  pageSize?: number
  emptyTitle?: string
  emptyMessage?: string
  defaultSort?: string
  defaultDir?: 'asc' | 'desc'
  dense?: boolean
}) {
  const [sortKey, setSortKey] = useState<string | null>(defaultSort ?? null)
  const [dir, setDir] = useState<'asc' | 'desc'>(defaultDir)
  const [page, setPage] = useState(0)

  const sorted = useMemo(() => {
    if (!sortKey) return rows
    const col = columns.find((c) => c.key === sortKey)
    if (!col?.sortValue) return rows
    const sv = col.sortValue
    return [...rows].sort((a, b) => {
      const va = sv(a)
      const vb = sv(b)
      const cmp = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb))
      return dir === 'asc' ? cmp : -cmp
    })
  }, [rows, sortKey, dir, columns])

  const pages = Math.max(1, Math.ceil(sorted.length / pageSize))
  const safePage = Math.min(page, pages - 1)
  const pageRows = sorted.slice(safePage * pageSize, (safePage + 1) * pageSize)

  const toggleSort = (key: string) => {
    if (sortKey === key) setDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else {
      setSortKey(key)
      setDir('desc')
    }
    setPage(0)
  }

  if (rows.length === 0) {
    return <EmptyState icon={<Inbox size={22} />} title={emptyTitle} message={emptyMessage} />
  }

  return (
    <div>
      <div className="overflow-x-auto -mx-px">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-line">
              {columns.map((c) => (
                <th
                  key={c.key}
                  className={clsx(
                    'label-2xs py-2.5 px-3 whitespace-nowrap select-none',
                    c.align === 'right' ? 'text-right' : c.align === 'center' ? 'text-center' : 'text-left',
                    c.sortValue && 'cursor-pointer hover:text-ink-mid transition-colors',
                    c.hideBelow && HIDE_CLS[c.hideBelow],
                  )}
                  onClick={c.sortValue ? () => toggleSort(c.key) : undefined}
                  aria-sort={sortKey === c.key ? (dir === 'asc' ? 'ascending' : 'descending') : undefined}
                >
                  <span className="inline-flex items-center gap-1">
                    {c.header}
                    {sortKey === c.key && (dir === 'asc' ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((row) => (
              <tr
                key={rowKey(row)}
                className={clsx(
                  'border-b border-line/60 last:border-0 transition-colors',
                  onRowClick && 'cursor-pointer hover:bg-surface-2',
                )}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                tabIndex={onRowClick ? 0 : undefined}
                onKeyDown={onRowClick ? (e) => { if (e.key === 'Enter') onRowClick(row) } : undefined}
              >
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={clsx(
                      dense ? 'py-2 px-3' : 'py-2.5 px-3',
                      c.align === 'right' ? 'text-right' : c.align === 'center' ? 'text-center' : 'text-left',
                      c.hideBelow && HIDE_CLS[c.hideBelow],
                      c.className,
                    )}
                  >
                    {c.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <div className="flex items-center justify-between pt-3 px-1">
          <span className="text-2xs text-ink-low">
            {safePage * pageSize + 1}–{Math.min(sorted.length, (safePage + 1) * pageSize)} of {sorted.length}
          </span>
          <div className="flex items-center gap-1">
            <button
              className="p-1.5 rounded-md hover:bg-surface-3 text-ink-mid disabled:opacity-30 transition-colors"
              disabled={safePage === 0}
              onClick={() => setPage(safePage - 1)}
              aria-label="Previous page"
            >
              <ChevronLeft size={14} />
            </button>
            <span className="text-2xs text-ink-mid num px-1">{safePage + 1}/{pages}</span>
            <button
              className="p-1.5 rounded-md hover:bg-surface-3 text-ink-mid disabled:opacity-30 transition-colors"
              disabled={safePage >= pages - 1}
              onClick={() => setPage(safePage + 1)}
              aria-label="Next page"
            >
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
