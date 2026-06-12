import Link from 'next/link'

export default function NotFound() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="text-2xl font-semibold">Página não encontrada</h1>
      <p className="text-sm text-gray-600">
        O projeto ou a página que você procura não existe (ou não é sua).
      </p>
      <Link href="/" className="bg-black text-white rounded px-4 py-2 min-h-11 flex items-center">
        Voltar para meus projetos
      </Link>
    </main>
  )
}
