import React, { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { Card } from '@/components/Common';
import { Loader2, CheckCircle, AlertTriangle } from 'lucide-react';
import { Invitation } from '@/types';

interface RegisterProps {
    token: string;
}

const Register: React.FC<RegisterProps> = ({ token }) => {
  const [invitation, setInvitation] = useState<Invitation | null>(null);
  const [loading, setLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');

  useEffect(() => {
    checkToken();
  }, [token]);

  const checkToken = async () => {
      try {
          const { data, error } = await supabase
            .from('invitations')
            .select('*')
            .eq('token', token)
            .is('used_at', null)
            .single();
          
          if (error) throw new Error("Invitation invalide ou expirée.");
          setInvitation(data);
      } catch (err: any) {
          setError(err.message);
      } finally {
          setLoading(false);
      }
  };

  const handleRegister = async (e: React.FormEvent) => {
      e.preventDefault();
      if (!invitation) return;
      setIsSubmitting(true);
      setError(null);

      try {
          // 1. Create Auth User
          const { data, error: signUpError } = await supabase.auth.signUp({
              email: invitation.email,
              password: password,
              options: {
                  data: {
                      full_name: fullName,
                  }
              }
          });

          if (signUpError) throw signUpError;
          if (!data.user) throw new Error("Erreur création utilisateur.");

          // 2. Create Profile & Assign Role/Team (Manual patch since trigger sets default)
          // We update the profile created by the trigger
          const { error: profileError } = await supabase
            .from('profiles')
            .update({
                role: invitation.role,
                team_id: invitation.team_id,
                full_name: fullName
            })
            .eq('id', data.user.id);
          
          if (profileError) console.warn("Profile update warning:", profileError);

          // 3. Mark invitation as used
          await supabase
            .from('invitations')
            .update({ used_at: new Date().toISOString() })
            .eq('id', invitation.id);

          alert("Compte créé avec succès ! Vous allez être redirigé.");
          window.location.href = '/';

      } catch (err: any) {
          setError(err.message);
          setIsSubmitting(false);
      }
  };

  if (loading) {
      return <div className="min-h-screen flex items-center justify-center bg-background"><Loader2 className="animate-spin text-primary" /></div>;
  }

  if (error) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-background p-4">
            <div className="max-w-md w-full text-center">
                <div className="w-12 h-12 bg-rose-50 text-rose-500 rounded-full flex items-center justify-center mx-auto mb-4 border border-rose-100">
                    <AlertTriangle size={24} />
                </div>
                <h2 className="text-xl font-medium text-primary mb-2">Invitation Invalide</h2>
                <p className="text-secondary mb-6">{error}</p>
                <a href="/" className="text-sm font-medium text-primary hover:underline">Retour à l'accueil</a>
            </div>
        </div>
      );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md">
         <div className="text-center mb-8">
            <h1 className="text-2xl font-semibold text-primary tracking-tight">Bienvenue</h1>
            <p className="text-secondary mt-2 text-sm">Finalisez votre compte pour rejoindre l'équipe.</p>
        </div>

        <Card>
            <form onSubmit={handleRegister} className="space-y-4">
                <div className="p-3 bg-blue-50 border border-blue-100 rounded text-sm text-blue-800 mb-4">
                    Invitation pour <span className="font-medium">{invitation?.email}</span>
                </div>

                <div>
                    <label className="block text-sm font-medium text-secondary mb-1">Nom complet</label>
                    <input
                        type="text"
                        required
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                        className="w-full px-3 py-2 bg-white border border-border rounded-md text-sm focus:ring-1 focus:ring-primary outline-none"
                        placeholder="Jean Dupont"
                    />
                </div>

                <div>
                    <label className="block text-sm font-medium text-secondary mb-1">Définir un mot de passe</label>
                    <input
                        type="password"
                        required
                        minLength={6}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="w-full px-3 py-2 bg-white border border-border rounded-md text-sm focus:ring-1 focus:ring-primary outline-none"
                        placeholder="Min. 6 caractères"
                    />
                </div>

                <button
                    type="submit"
                    disabled={isSubmitting}
                    className="w-full py-2.5 bg-primary text-white text-sm font-medium rounded-md hover:bg-black transition-all disabled:opacity-70 mt-4"
                >
                    {isSubmitting ? 'Création...' : 'Créer mon compte'}
                </button>
            </form>
        </Card>
      </div>
    </div>
  );
};

export default Register;