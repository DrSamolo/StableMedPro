import Link from "next/link";

export default function UnauthorizedPage() {
  return (
    <main className="min-h-screen bg-background text-primary flex items-center justify-center p-6">
      <div className="max-w-md w-full bg-surface border border-border rounded-lg shadow-card p-8">
        <h1 className="text-xl font-semibold mb-2">Acces refuse</h1>
        <p className="text-secondary text-sm mb-6">
          Cette section est reservee aux administrateurs.
        </p>
        <Link href="/" className="inline-flex items-center justify-center px-4 py-2 rounded bg-primary text-white text-sm">
          Retour a l&apos;accueil
        </Link>
      </div>
    </main>
  );
}
