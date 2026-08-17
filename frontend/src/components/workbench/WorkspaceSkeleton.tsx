interface WorkspaceSkeletonProps {
  kind: 'notebook' | 'source'
}

const bar = 'rounded-[var(--surface-radius)] bg-muted'

export function WorkspaceSkeleton({ kind }: WorkspaceSkeletonProps) {
  return (
    <div
      role="status"
      aria-label="Loading workspace"
      className="flex min-h-0 flex-1 flex-col animate-pulse"
    >
      <div className="px-4 pt-3 lg:px-6 lg:pt-4">
        <div className="flex items-start gap-3 pb-3">
          <div className={`${bar} size-10 shrink-0`} />
          <div className="grid min-w-0 flex-1 gap-2 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
            <div className="min-w-0 space-y-2">
              <div className={`${bar} h-7 w-2/5 min-w-48`} />
              <div className={`${bar} h-4 w-1/3 min-w-36`} />
            </div>
            <div className="flex gap-2">
              <div className={`${bar} h-8 w-20`} />
              <div className={`${bar} size-8`} />
            </div>
            <div className="flex flex-wrap gap-2 md:col-span-2">
              <div className={`${bar} h-6 w-16 rounded-full`} />
              <div className={`${bar} h-6 w-28 rounded-full`} />
              <div className={`${bar} h-6 w-32 rounded-full`} />
            </div>
          </div>
        </div>
      </div>
      <div className="min-h-0 flex-1">
        <div className="flex h-full min-h-[28rem] overflow-hidden border border-border bg-background">
          <div className="w-[46%] min-w-72 space-y-4 p-4">
            <div className="flex gap-4 border-b border-border pb-3">
              <div className={`${bar} h-4 w-24`} />
              <div className={`${bar} h-4 w-20`} />
            </div>
            {kind === 'notebook' && <div className={`${bar} h-9 w-28`} />}
            {[0, 1, 2].map(item => (
              <div key={item} className="space-y-3 border border-border p-4">
                <div className={`${bar} h-4 w-4/5`} />
                <div className={`${bar} h-3 w-1/2`} />
                <div className={`${bar} h-8 w-32`} />
              </div>
            ))}
          </div>
          <div className="w-1.5 bg-muted" />
          <div className="flex min-w-80 flex-1 flex-col">
            <div className="flex items-center gap-3 border-b border-border p-4 pr-12">
              <div className={`${bar} h-5 w-40`} />
              <div className={`${bar} ml-auto h-8 w-20`} />
            </div>
            <div className="flex flex-1 flex-col gap-3 p-4">
              <div className={`${bar} h-16 w-3/4 self-end`} />
              <div className={`${bar} h-24 w-4/5`} />
            </div>
            <div className="space-y-3 p-4">
              <div className={`${bar} h-10 w-full`} />
              <div className={`${bar} h-8 w-36`} />
              <div className="flex gap-2">
                <div className={`${bar} h-12 flex-1`} />
                <div className={`${bar} size-12`} />
              </div>
            </div>
          </div>
        </div>
      </div>
      <span className="sr-only">Loading workspace</span>
    </div>
  )
}
