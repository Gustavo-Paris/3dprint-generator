export default function Loading() {
  return (
    <main className="max-w-3xl mx-auto p-8 space-y-6 animate-pulse" aria-busy="true" aria-label="Carregando">
      <div className="flex items-baseline justify-between">
        <div className="h-7 w-40 rounded bg-gray-200" />
        <div className="h-4 w-32 rounded bg-gray-200" />
      </div>
      <div className="flex gap-2">
        <div className="h-11 flex-1 rounded bg-gray-200" />
        <div className="h-11 w-20 rounded bg-gray-200" />
      </div>
      <ul className="space-y-2">
        {[0, 1, 2].map((i) => (
          <li key={i} className="h-16 rounded border bg-gray-100" />
        ))}
      </ul>
    </main>
  )
}
