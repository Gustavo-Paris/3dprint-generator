export default function Loading() {
  return (
    <main className="h-screen flex flex-col lg:grid lg:grid-cols-[420px_1fr] animate-pulse" aria-busy="true" aria-label="Carregando projeto">
      <aside className="border-r flex flex-col gap-3 p-4">
        <div className="h-6 w-40 rounded bg-gray-200" />
        <div className="h-20 rounded bg-gray-100" />
        <div className="h-20 rounded bg-gray-100" />
      </aside>
      <section className="bg-gray-50" />
    </main>
  )
}
