import React, { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Card } from '@/components/Common';
import { Lock } from 'lucide-react';

const Login: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
    } catch (err: any) {
      setError(err.message === 'Invalid login credentials' ? 'Identifiants incorrects' : err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
            <div className="w-10 h-10 bg-primary rounded-lg mx-auto mb-4 flex items-center justify-center shadow-lg">
                <div className="w-4 h-4 bg-white rounded-full opacity-90"></div>
            </div>
            <h1 className="text-2xl font-semibold text-primary tracking-tight">StableMed</h1>
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
              className="w-full py-2.5 bg-primary text-white text-sm font-medium rounded-md hover:bg-black transition-all shadow-subtle disabled:opacity-70 disabled:cursor-not-allowed mt-2"
            >
              {loading ? 'Connexion...' : 'Se connecter'}
            </button>
          </form>
        </Card>
        
        <div className="text-center mt-8">
            <p className="text-xs text-gray-400">
                Vous n'avez pas de compte ? Contactez votre administrateur pour recevoir une invitation.
            </p>
             <p className="text-xs text-gray-300 mt-2">
                &copy; 2024 StableMed CRM. Closed Access.
            </p>
        </div>
      </div>
    </div>
  );
};

export default Login;