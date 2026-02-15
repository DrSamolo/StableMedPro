"use client";

import React, { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { BrandLockup, BrandMark, Card } from '@/components/Common';
import { Loader2, AlertTriangle } from 'lucide-react';
import { Invitation } from '@/types';

interface RegisterProps {
    token: string;
}

type InvitationSignupContext = Pick<Invitation, 'email' | 'role' | 'team_id' | 'expires_at'>;

const Register: React.FC<RegisterProps> = ({ token }) => {
  const [invitation, setInvitation] = useState<InvitationSignupContext | null>(null);
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
          const { data, error } = await supabase.rpc('get_invitation_signup_context', {
            p_token: token,
          });

          if (error) throw new Error("Invitation invalide ou expirée.");
          const invitationData = Array.isArray(data) ? data[0] : null;
          if (!invitationData) throw new Error("Invitation invalide ou expirée.");
          setInvitation(invitationData as InvitationSignupContext);
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

          // 2. Ensure profile exists and apply invitation role/team.
          // Upsert makes this robust even if DB trigger is missing.
          const { error: profileError } = await supabase
            .from('profiles')
            .upsert({
                id: data.user.id,
                email: invitation.email,
                role: invitation.role,
                team_id: invitation.team_id,
                full_name: fullName
            }, { onConflict: 'id' });
          
          if (profileError) throw profileError;

          // 3. Mark invitation as used
          const { error: consumeError } = await supabase.rpc('consume_invitation_token', {
            p_token: token,
          });
          if (consumeError) throw consumeError;

          alert("Compte créé avec succès ! Vous allez être redirigé.");
          window.location.href = '/';

      } catch (err: any) {
          setError(err.message);
          setIsSubmitting(false);
      }
  };

  if (loading) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-background">
          <div className="flex flex-col items-center gap-3">
            <BrandMark className="h-11 w-11 animate-[spin_1.15s_linear_infinite] shadow-card" />
            <p className="text-sm text-secondary">Vérification de l&apos;invitation...</p>
          </div>
        </div>
      );
  }

  if (error) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-background p-4">
            <div className="max-w-md w-full text-center">
                <BrandLockup compact className="justify-center mb-6" />
                <h1 className="text-2xl font-semibold text-primary tracking-tight mb-2">SudMed CRM</h1>
                <p className="text-secondary mb-6 text-sm">CRM médical sécurisé sur invitation</p>

                <div className="mb-5 rounded-md border border-rose-200/70 bg-rose-50/50 px-3 py-2 text-left text-sm text-rose-700">
                  <div className="flex items-center gap-2">
                    <AlertTriangle size={14} />
                    <span className="font-medium">Invitation invalide ou expirée</span>
                  </div>
                  <p className="mt-1.5 text-xs text-rose-700/90">{error}</p>
                </div>
                <p className="text-sm text-secondary">
                  Demandez un nouveau lien d&apos;invitation à votre administrateur.
                </p>
            </div>
        </div>
      );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md">
         <div className="text-center mb-8">
            <BrandLockup compact className="justify-center mb-4" />
            <p className="text-base font-medium text-primary">Créer votre compte</p>
            <p className="text-secondary mt-1 text-sm">Finalisez votre inscription pour rejoindre votre équipe.</p>
        </div>

        <Card>
            <form onSubmit={handleRegister} className="space-y-4">
                <div className="rounded-md border border-border bg-zinc-50 px-3 py-2.5 text-sm text-secondary mb-4">
                    Invitation pour <span className="font-medium text-primary">{invitation?.email}</span>
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
                    className="w-full py-2.5 bg-primary text-white text-sm font-medium rounded-md hover:bg-black transition-all shadow-subtle disabled:opacity-70 mt-4 inline-flex items-center justify-center gap-2"
                >
                    {isSubmitting ? <Loader2 size={16} className="animate-spin" /> : null}
                    {isSubmitting ? 'Création...' : 'Créer mon compte'}
                </button>
            </form>
        </Card>
      </div>
    </div>
  );
};

export default Register;
