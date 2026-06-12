/**
 * Brand identity for the product. The mark is an isometric cube (the three faces
 * shaded in the brand blue) — reads instantly as "3D" and gives the app the
 * memorable identity the design critique flagged as missing (P0-3).
 */

export function BrandMark({ className = 'h-6 w-6' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden="true">
      <path d="M12 2 21 7 12 12 3 7Z" fill="#60a5fa" />
      <path d="M3 7 12 12 12 22 3 17Z" fill="#2563eb" />
      <path d="M21 7 12 12 12 22 21 17Z" fill="#3b82f6" />
    </svg>
  )
}

export function Brand({
  markClassName = 'h-7 w-7',
  textClassName = 'text-base text-slate-900',
}: {
  markClassName?: string
  textClassName?: string
}) {
  return (
    <span className="inline-flex items-center gap-2 font-semibold tracking-tight">
      <BrandMark className={markClassName} />
      <span className={textClassName}>Gerador 3D</span>
    </span>
  )
}
