import Register from "@/components/auth/register-page";

type RegisterPageProps = {
  searchParams?: Promise<{ token?: string | string[] }>;
};

export default async function RegisterPage({ searchParams }: RegisterPageProps) {
  const params = searchParams ? await searchParams : {};
  const rawToken = params.token;
  const token = Array.isArray(rawToken) ? rawToken[0] : rawToken;

  if (!token || !token.trim()) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="w-full max-w-md text-center">
          <h1 className="text-xl font-medium text-primary mb-2">Lien d&apos;invitation invalide</h1>
          <p className="text-secondary text-sm">
            Ce lien est incomplet. Demandez une nouvelle invitation à votre administrateur.
          </p>
        </div>
      </div>
    );
  }

  return <Register token={token} />;
}
