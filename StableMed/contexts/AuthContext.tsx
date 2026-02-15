import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { Session, User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { Profile } from '../types';
import { perfEnd, perfStart } from '@/lib/perf/metrics';

interface AuthContextType {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  permissions: Record<string, boolean>;
  loading: boolean;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({ 
  session: null, 
  user: null, 
  profile: null,
  permissions: {},
  loading: true, 
  signOut: async () => {},
  refreshProfile: async () => {}
});

const PROFILE_CACHE_TTL_MS = 2 * 60 * 1000;
const PERMISSIONS_CACHE_TTL_MS = 5 * 60 * 1000;

let profileCache:
  | {
      userId: string;
      at: number;
      profile: Profile;
    }
  | null = null;

const permissionsCache = new Map<string, { at: number; permissions: Record<string, boolean> }>();

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [permissions, setPermissions] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const profileIdRef = useRef<string | null>(null);
  const ensuredAllChatUserIdRef = useRef<string | null>(null);

  const ensureAllChatMembership = async (userId: string) => {
    if (ensuredAllChatUserIdRef.current === userId) return;
    try {
      const { error } = await supabase.rpc('ensure_actor_all_chat_membership', {
        p_actor_id: userId,
      });
      if (error) {
        const code = (error as { code?: string }).code ?? '';
        const missingRpc =
          code === 'PGRST202' ||
          code === '42883' ||
          String(error.message || '').toLowerCase().includes('not found');
        if (!missingRpc) {
          console.warn('ensure_actor_all_chat_membership failed:', error.message);
        }
        return;
      }
      ensuredAllChatUserIdRef.current = userId;
    } catch (e) {
      console.warn('ensure_actor_all_chat_membership unexpected error:', e);
    }
  };

  const fetchPermissions = async (role: string) => {
    const cachedPermissions = permissionsCache.get(role);
    if (cachedPermissions && Date.now() - cachedPermissions.at < PERMISSIONS_CACHE_TTL_MS) {
      setPermissions(cachedPermissions.permissions);
      return;
    }

    try {
      const { data, error } = await supabase
        .from('role_permissions')
        .select('permissions')
        .eq('role', role)
        .maybeSingle();
        
      if (!error && data) {
        setPermissions(data.permissions);
        permissionsCache.set(role, { at: Date.now(), permissions: data.permissions });
      } else {
        // Fallback defaults if table is empty or error
        setPermissions({});
      }
    } catch (e) {
      console.error("Error fetching permissions", e);
    }
  };

  const hydrateFromSession = (session: Session | null) => {
    setSession(session);
    setUser(session?.user ?? null);
    setLoading(false);

    if (session?.user) {
      void fetchProfile(session.user.id);
    } else {
      setProfile(null);
      setPermissions({});
    }
  };

  const fetchProfile = async (userId: string, options?: { force?: boolean }) => {
    const force = options?.force ?? false;
    if (!force && profileCache && profileCache.userId === userId && Date.now() - profileCache.at < PROFILE_CACHE_TTL_MS) {
      setProfile(profileCache.profile);
      if (profileCache.profile.role) {
        void fetchPermissions(profileCache.profile.role);
      }
      return;
    }

    perfStart('auth.fetchProfile');
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id,email,full_name,avatar_url,role,manager_id,team_id,created_at')
        .eq('id', userId)
        .maybeSingle();
      
      if (error) {
        // Keep dev overlay clean for recoverable auth/profile mismatches.
        console.warn('Error fetching profile:', error.message);
        return;
      }

      let userProfile = data as Profile | null;

      // Self-heal missing profile rows (common after RLS/schema migrations).
      if (!userProfile) {
        const { data: authUserData } = await supabase.auth.getUser();
        const authUser = authUserData.user;
        const fallbackEmail = authUser?.email ?? '';
        const fallbackName =
          (typeof authUser?.user_metadata?.full_name === 'string'
            ? authUser.user_metadata.full_name
            : '') || fallbackEmail.split('@')[0] || 'Utilisateur';

        const { error: upsertError } = await supabase.from('profiles').upsert(
          {
            id: userId,
            email: fallbackEmail,
            full_name: fallbackName,
            role: 'commercial',
          },
          { onConflict: 'id' },
        );

        if (upsertError) {
          console.warn('Unable to auto-create profile row:', upsertError.message);
          return;
        }

        const refetch = await supabase
          .from('profiles')
          .select('id,email,full_name,avatar_url,role,manager_id,team_id,created_at')
          .eq('id', userId)
          .maybeSingle();
        if (refetch.error || !refetch.data) {
          console.warn('Profile still missing after upsert');
          return;
        }
        userProfile = refetch.data as Profile;
      }

      setProfile(userProfile);
      profileCache = { userId, at: Date.now(), profile: userProfile };
      if (userProfile.role) {
        void fetchPermissions(userProfile.role);
      }
      void ensureAllChatMembership(userId);
    } catch (error) {
      console.warn('Unexpected error fetching profile:', error);
    } finally {
      perfEnd('auth.fetchProfile');
    }
  };

  useEffect(() => {
    profileIdRef.current = profile?.id ?? null;
  }, [profile?.id]);

  useEffect(() => {
    const currentUserId = user?.id;
    if (!currentUserId) return;

    const refreshOnForeground = () => {
      void fetchProfile(currentUserId, { force: true });
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        refreshOnForeground();
      }
    };

    window.addEventListener('focus', refreshOnForeground);
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      window.removeEventListener('focus', refreshOnForeground);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [user?.id]);

  useEffect(() => {
    perfStart('auth.bootstrap');
    // Check active session
    supabase.auth.getSession().then(({ data: { session } }) => {
      hydrateFromSession(session);
      perfEnd('auth.bootstrap');
    });

    // Listen for changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      const nextUserId = session?.user?.id ?? null;
      const isRefreshEvent = event === 'TOKEN_REFRESHED';

      if (isRefreshEvent && profileIdRef.current === nextUserId) {
        setSession(session);
        setUser(session?.user ?? null);
        setLoading(false);
        return;
      }

      hydrateFromSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
    setProfile(null);
    setPermissions({});
    profileCache = null;
    ensuredAllChatUserIdRef.current = null;
  };

  const refreshProfile = async () => {
    if (user) {
      profileCache = null;
      await fetchProfile(user.id, { force: true });
    }
  };

  return (
    <AuthContext.Provider value={{ session, user, profile, permissions, loading, signOut, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
