import { Check, ChevronDown } from 'lucide-react'
import { AnimatePresence, motion, useIsPresent, useReducedMotion } from 'motion/react'
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

import { fieldClass } from '@/components/ui/field'
import { createPresenceVariants, MOTION_INSTANT, MOTION_SPRING } from '@/lib/motion'
import { cn } from '@/lib/utils'

export interface SelectOption<V extends string = string> {
  value: V
  label: ReactNode
  /** Plain text for typeahead and tooltips; defaults to `label` when it is a string. */
  text?: string
  title?: string
  disabled?: boolean
}

interface SelectProps<V extends string> {
  value: V
  onChange: (value: V) => void
  options: readonly SelectOption<V>[]
  /** Shown when no option matches `value`. */
  placeholder?: ReactNode
  name?: string
  id?: string
  disabled?: boolean
  title?: string
  className?: string
  'aria-label'?: string
}

const MENU_MAX_HEIGHT = 320
const MENU_MAX_WIDTH = 448
const VIEWPORT_MARGIN = 8
const TYPEAHEAD_RESET_MS = 500

interface MenuPlacement {
  side: 'bottom' | 'top'
  left: number
  top?: number
  bottom?: number
  minWidth: number
  maxWidth: number
  maxHeight: number
}

function placeMenu(trigger: HTMLElement): MenuPlacement {
  const rect = trigger.getBoundingClientRect()
  const below = window.innerHeight - rect.bottom - VIEWPORT_MARGIN
  const above = rect.top - VIEWPORT_MARGIN
  const side = below < 200 && above > below ? 'top' : 'bottom'
  const minWidth = Math.min(rect.width, window.innerWidth - VIEWPORT_MARGIN * 2)
  const left = Math.max(VIEWPORT_MARGIN, Math.min(rect.left, window.innerWidth - minWidth - VIEWPORT_MARGIN))
  return {
    side,
    left,
    minWidth,
    maxWidth: Math.max(minWidth, Math.min(MENU_MAX_WIDTH, window.innerWidth - left - VIEWPORT_MARGIN)),
    maxHeight: Math.min(MENU_MAX_HEIGHT, side === 'bottom' ? below : above),
    ...(side === 'bottom'
      ? { top: rect.bottom + 4 }
      : { bottom: window.innerHeight - rect.top + 4 }),
  }
}

function optionText(option: SelectOption<string>): string {
  return option.text ?? (typeof option.label === 'string' ? option.label : option.value)
}

/**
 * A listbox in place of the native `<select>`, whose popup cannot be animated or
 * styled. It keeps the native contract: one value, keyboard selection, typeahead,
 * and Escape closes the popup without closing the dialog around it.
 */
export function Select<V extends string>({
  value,
  onChange,
  options,
  placeholder,
  name,
  id,
  disabled = false,
  title,
  className,
  'aria-label': ariaLabel,
}: SelectProps<V>) {
  const listboxId = useId()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [placement, setPlacement] = useState<MenuPlacement | null>(null)
  const [mounted, setMounted] = useState(false)
  const selectedIndex = options.findIndex((option) => option.value === value)
  const selected = selectedIndex >= 0 ? options[selectedIndex] : undefined
  const open = placement !== null

  useEffect(() => setMounted(true), [])
  useEffect(() => {
    if (disabled) setPlacement(null)
  }, [disabled])

  const openMenu = () => {
    if (disabled || options.length === 0 || !triggerRef.current) return
    setPlacement(placeMenu(triggerRef.current))
  }
  const closeMenu = (refocus: boolean) => {
    setPlacement(null)
    if (refocus) triggerRef.current?.focus()
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        id={id}
        name={name}
        role="combobox"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        data-value={value}
        title={title ?? selected?.title}
        disabled={disabled}
        onClick={() => (open ? closeMenu(false) : openMenu())}
        onKeyDown={(event) => {
          if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) {
            event.preventDefault()
            openMenu()
          }
        }}
        className={cn(
          fieldClass,
          'flex items-center gap-2 text-left disabled:cursor-not-allowed disabled:opacity-60 focus-visible:ring-[3px] focus-visible:ring-ring/50',
          className
        )}
      >
        <span className={cn('min-w-0 flex-1 truncate', !selected && 'text-muted-foreground')}>
          {selected ? selected.label : placeholder}
        </span>
        <ChevronDown
          aria-hidden
          className={cn(
            'size-4 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none',
            open && 'rotate-180'
          )}
        />
      </button>
      {mounted &&
        createPortal(
          <AnimatePresence>
            {placement && (
              <SelectMenu
                key="menu"
                id={listboxId}
                label={ariaLabel}
                placement={placement}
                options={options}
                selectedIndex={selectedIndex}
                onPick={(next) => {
                  closeMenu(true)
                  if (next !== value) onChange(next)
                }}
                onDismiss={closeMenu}
              />
            )}
          </AnimatePresence>,
          document.body
        )}
    </>
  )
}

function SelectMenu<V extends string>({
  id,
  label,
  placement,
  options,
  selectedIndex,
  onPick,
  onDismiss,
}: {
  id: string
  label?: string
  placement: MenuPlacement
  options: readonly SelectOption<V>[]
  selectedIndex: number
  onPick: (value: V) => void
  onDismiss: (refocus: boolean) => void
}) {
  const listRef = useRef<HTMLDivElement>(null)
  const isPresent = useIsPresent()
  const reducedMotion = useReducedMotion() ?? false
  const firstEnabled = options.findIndex((option) => !option.disabled)
  const [active, setActive] = useState(selectedIndex >= 0 ? selectedIndex : firstEnabled)
  const typeahead = useRef({ text: '', at: 0 })
  const optionId = (index: number) => `${id}-option-${index}`
  const variants = createPresenceVariants({
    timing: 'micro',
    transform: { scale: 0.96, y: placement.side === 'bottom' ? -4 : 4 },
    reducedMotion,
  })

  useLayoutEffect(() => {
    listRef.current?.focus({ preventScroll: true })
  }, [])

  useEffect(() => {
    document.getElementById(`${id}-option-${active}`)?.scrollIntoView({ block: 'nearest' })
  }, [id, active])

  // The menu is pinned to where the trigger was; once the page under it moves
  // it would float detached, so it closes like a native popup does.
  useEffect(() => {
    if (!isPresent) return
    const close = (event: Event) => {
      if (event.target instanceof Node && listRef.current?.contains(event.target)) return
      onDismiss(false)
    }
    window.addEventListener('resize', close)
    window.addEventListener('scroll', close, true)
    return () => {
      window.removeEventListener('resize', close)
      window.removeEventListener('scroll', close, true)
    }
  }, [isPresent, onDismiss])

  const step = (from: number, delta: 1 | -1) => {
    for (let i = from + delta; i >= 0 && i < options.length; i += delta) {
      if (!options[i].disabled) return i
    }
    return from
  }

  const onKeyDown = (event: React.KeyboardEvent) => {
    const key = event.key
    if (key === 'Escape' || key === 'Tab') {
      event.preventDefault()
      event.stopPropagation()
      onDismiss(true)
    } else if (key === 'ArrowDown' || key === 'ArrowUp') {
      event.preventDefault()
      setActive((index) => step(index, key === 'ArrowDown' ? 1 : -1))
    } else if (key === 'Home' || key === 'End') {
      event.preventDefault()
      setActive(key === 'Home' ? step(-1, 1) : step(options.length, -1))
    } else if (key === 'Enter' || key === ' ') {
      event.preventDefault()
      const option = options[active]
      if (option && !option.disabled) onPick(option.value)
    } else if (key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
      const now = Date.now()
      const buffer = now - typeahead.current.at > TYPEAHEAD_RESET_MS ? key : typeahead.current.text + key
      typeahead.current = { text: buffer, at: now }
      const needle = buffer.toLowerCase()
      const match = options.findIndex(
        (option) => !option.disabled && optionText(option).toLowerCase().startsWith(needle)
      )
      if (match >= 0) setActive(match)
    }
  }

  return (
    <>
      {isPresent && (
        <div
          aria-hidden
          className="fixed inset-0 z-[60]"
          onPointerDown={(event) => {
            event.preventDefault()
            onDismiss(true)
          }}
        />
      )}
      <motion.div
        ref={listRef}
        id={id}
        role="listbox"
        aria-label={label}
        aria-activedescendant={active >= 0 ? optionId(active) : undefined}
        tabIndex={-1}
        initial="hidden"
        animate="visible"
        exit="exit"
        variants={variants}
        onKeyDown={onKeyDown}
        style={{
          left: placement.left,
          top: placement.top,
          bottom: placement.bottom,
          minWidth: placement.minWidth,
          maxWidth: placement.maxWidth,
          maxHeight: placement.maxHeight,
          transformOrigin: placement.side === 'bottom' ? 'top' : 'bottom',
        }}
        className={cn(
          'fixed z-[60] overflow-y-auto rounded-md border border-border bg-popover p-1 text-sm text-popover-foreground shadow-lg outline-none',
          !isPresent && 'pointer-events-none'
        )}
      >
        {options.map((option, index) => {
          const isSelected = index === selectedIndex
          return (
            <div
              key={option.value}
              id={optionId(index)}
              role="option"
              data-value={option.value}
              aria-selected={isSelected}
              aria-disabled={option.disabled || undefined}
              title={option.title}
              onPointerMove={() => !option.disabled && setActive(index)}
              onClick={() => !option.disabled && onPick(option.value)}
              className={cn(
                'relative flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5',
                option.disabled && 'opacity-50'
              )}
            >
              {index === active && (
                <motion.span
                  layoutId={`${id}-highlight`}
                  transition={reducedMotion ? MOTION_INSTANT : MOTION_SPRING.indicator}
                  className="absolute inset-0 rounded-sm bg-accent"
                />
              )}
              <span className={cn('relative min-w-0 flex-1 truncate', index === active && 'text-accent-foreground')}>
                {option.label}
              </span>
              <Check aria-hidden className={cn('relative size-3.5 shrink-0', !isSelected && 'invisible')} />
            </div>
          )
        })}
      </motion.div>
    </>
  )
}
