import React, { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { BrandLockup, BrandMark, Card } from '@/components/Common';
import { Loader2, Lock } from 'lucide-react';

const PENDING_INVITATION_STORAGE_KEY = 'pending_invitation_signup';

const Login: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const withTimeout = async <T,>(promise: Promise<T>, timeoutMs: number): Promise<T> => {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error('AUTH_TIMEOUT')), timeoutMs);
    });

    try {
      return await Promise.race([promise, timeoutPromise]);
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  };

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
        const { data, error } = await withTimeout(
          supabase.auth.signInWithPassword({
            email,
            password,
          }),
          12000,
        );

        if (error) throw error;
        if (!data.session) {
          const { data: sessionData } = await supabase.auth.getSession();
          if (!sessionData.session) {
            throw new Error('Session introuvable après authentification.');
          }
        }

        const pendingRaw = localStorage.getItem(PENDING_INVITATION_STORAGE_KEY);
        if (pendingRaw) {
          try {
            const pending = JSON.parse(pendingRaw) as { token?: string; fullName?: string | null };
            if (pending?.token) {
              const { error: finalizeError } = await supabase.rpc('finalize_invitation_signup', {
                p_token: pending.token,
                p_full_name:
                  typeof pending.fullName === 'string' && pending.fullName.trim().length > 0
                    ? pending.fullName.trim()
                    : null,
              });
              if (finalizeError) throw finalizeError;
            }
            localStorage.removeItem(PENDING_INVITATION_STORAGE_KEY);
          } catch (pendingError: any) {
            const rawMessage = String(pendingError?.message || '');
            setError(rawMessage || "Connexion réussie mais finalisation de l'invitation impossible.");
            setLoading(false);
            return;
          }
        }

        // Hard navigation avoids client-side race with middleware auth checks.
        window.location.assign('/dashboard');
        return;
    } catch (err: any) {
      if (err?.message === 'AUTH_TIMEOUT') {
        const { data: sessionData } = await supabase.auth.getSession();
        if (sessionData.session) {
          window.location.assign('/dashboard');
          return;
        }
      }

      const rawMessage = String(err?.message || '');
      const normalizedMessage =
        rawMessage === 'Invalid login credentials'
          ? 'Identifiants incorrects'
          : rawMessage === 'AUTH_TIMEOUT'
            ? 'Le service d’authentification est lent. Vérifiez votre connexion puis réessayez.'
            : rawMessage;

      setError(normalizedMessage);
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
            <BrandLockup compact className="justify-center mb-4" />
            <h1 className="text-2xl font-semibold text-primary tracking-tight">SudMed CRM</h1>
            <p className="text-secondary mt-2 text-sm">CRM médical sécurisé sur invitation</p>
        </div>

        <Card>
          <form onSubmit={handleAuth} className="space-y-4">
            {error && (
              <div className="p-3 bg-red-50 text-red-600 text-sm rounded-md border border-red-100 flex items-center gap-2">
                <Lock size={14} /> {error}
              </div>
            )}
            
            <div>
              <label className="block text-sm font-medium text-secondary mb-1">Email</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-border rounded-md text-sm focus:ring-1 focus:ring-primary focus:border-primary outline-none transition-all"
                placeholder="nom@exemple.com"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-secondary mb-1">Mot de passe</label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-border rounded-md text-sm focus:ring-1 focus:ring-primary focus:border-primary outline-none transition-all"
                placeholder="••••••••"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 bg-primary text-white text-sm font-medium rounded-md hover:bg-black transition-all shadow-subtle disabled:opacity-70 disabled:cursor-not-allowed mt-2 inline-flex items-center justify-center gap-2"
            >
              {loading ? <Loader2 size={16} className="animate-spin" /> : null}
              {loading ? 'Connexion...' : 'Se connecter'}
            </button>
          </form>
        </Card>
        
        <div className="text-center mt-8">
            <p className="text-xs text-gray-400">
                Vous n'avez pas de compte ? Contactez votre administrateur pour recevoir une invitation.
            </p>
             <p className="text-xs text-gray-300 mt-2">
                &copy; 2024 SudMed CRM. Closed Access.
            </p>
        </div>
      </div>

      {loading ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/85 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-4">
            <div className="motion-fade-up">
              <BrandMark className="h-11 w-11 animate-[spin_1.15s_linear_infinite] shadow-card" />
            </div>
            <p className="text-sm text-secondary">Ouverture de votre espace...</p>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default Login;
