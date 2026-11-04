import { Plus } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/** The page header's call to action: the one primary button at the right end of every view's tab row. */
export function NewTaskButton({ onClick, className }: { onClick: () => void; className?: string }) {
  return (
    <Button size="sm" onClick={onClick} aria-label="新增任務" title="新增任務" className={cn('ml-auto shrink-0', className)}>
      <Plus className="size-4" />
      <span className="hidden sm:inline">新增任務</span>
    </Button>
  )
}
