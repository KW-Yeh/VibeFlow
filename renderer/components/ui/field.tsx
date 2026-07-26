// Shared form-field class — uniform height, subtle border, and the standard
// 3px focus ring. Single source of truth for input / select / textarea styling
// across the dialogs (PLAN §2.1 I4). Compose extra classes with
// `cn(fieldClass, 'font-mono text-sm', …)`; tailwind-merge resolves overrides.
export const fieldClass =
  'w-full rounded-md border bg-background px-3 py-2 text-base outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 transition-shadow motion-reduce:transition-none'
