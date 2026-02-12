export default function AdminPage() {
  return (
    <main className="min-h-screen bg-background text-primary p-8">
      <div className="max-w-4xl mx-auto bg-surface border border-border rounded-lg shadow-card p-8">
        <h1 className="text-2xl font-semibold mb-3">Espace Admin</h1>
        <p className="text-secondary text-sm">
          Route protegee par le middleware Next.js et le role `admin` dans `profiles`.
        </p>
      </div>
    </main>
  );
}
