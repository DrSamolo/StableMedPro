import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { Profile, Team } from '../types';
import { useAuth } from './AuthContext';
import { perfEnd, perfStart } from '@/lib/perf/metrics';

interface DataContextType {
  teams: Team[];
  users: Profile[];
  selectedTeamId: string | 'all';
  selectedUserId: string | 'all';
  setTeamFilter: (teamId: string | 'all') => void;
  setUserFilter: (userId: string | 'all') => void;
  filteredUsers: Profile[]; // Users matching the selected team
  loadingFilters: boolean;
}

const DataContext = createContext<DataContextType>({
  teams: [],
  users: [],
  selectedTeamId: 'all',
  selectedUserId: 'all',
  setTeamFilter: () => {},
  setUserFilter: () => {},
  filteredUsers: [],
  loadingFilters: true,
});

const FILTER_CACHE_TTL_MS = 2 * 60 * 1000;

let filterCache:
  | {
      key: string;
      at: number;
      teams: Team[];
      users: Profile[];
    }
  | null = null;

export const DataProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { profile } = useAuth();
  const [teams, setTeams] = useState<Team[]>([]);
  const [users, setUsers] = useState<Profile[]>([]);
  
  const [selectedTeamId, setSelectedTeamId] = useState<string | 'all'>('all');
  const [selectedUserId, setSelectedUserId] = useState<string | 'all'>('all');
  const [loadingFilters, setLoadingFilters] = useState(true);
  const normalizedRole = (profile?.role ?? '').trim().toLowerCase();
  const isAdmin = normalizedRole === 'admin';
  const isManager = normalizedRole === 'manager';

  const applyRoleDefaultSelection = useCallback(
    (managerTeamId: string | null) => {
      if (!profile) return;
      if (normalizedRole === 'commercial') {
        setSelectedUserId(profile.id);
        if (profile.team_id) setSelectedTeamId(profile.team_id);
        return;
      }
      if (normalizedRole === 'representant') {
        // Representant must rely on backend RLS scope (organizations), not owner-only filtering.
        setSelectedUserId('all');
        setSelectedTeamId('all');
        return;
      }
      if (isManager && managerTeamId) {
        setSelectedUserId('all');
        setSelectedTeamId(managerTeamId);
      }
    },
    [isManager, normalizedRole, profile],
  );

  // Initialize filters based on Role
  useEffect(() => {
    if (!profile) return;

    let active = true;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let idleId: number | null = null;
    const win = window as Window & {
      requestIdleCallback?: (callback: () => void) => number;
      cancelIdleCallback?: (handle: number) => void;
    };

    const run = () => {
      if (!active) return;
      void loadFilterData();
    };

    if (typeof win.requestIdleCallback === 'function') {
      idleId = win.requestIdleCallback(run);
    } else {
      timeoutId = setTimeout(run, 220);
    }

    return () => {
      active = false;
      if (timeoutId) clearTimeout(timeoutId);
      if (idleId !== null && typeof win.cancelIdleCallback === 'function') {
        win.cancelIdleCallback(idleId);
      }
    };
  }, [profile]);

  const loadFilterData = useCallback(async () => {
    if (!profile) return;
    perfStart('data.filters');
    const cacheKey = `${profile.role}:${profile.team_id ?? 'none'}:${profile.id}`;
    const canUseCache = !isAdmin && !isManager;

    setLoadingFilters(true);

    if (isAdmin) {
      try {
        const { error } = await supabase.rpc('sync_missing_profiles_from_auth');
        if (error) {
          const code = (error as { code?: string }).code ?? '';
          const missingRpc =
            code === 'PGRST202' ||
            code === '42883' ||
            String(error.message || '').toLowerCase().includes('not found');
          if (!missingRpc) {
            console.warn('sync_missing_profiles_from_auth failed:', error.message);
          }
        }
      } catch (error) {
        console.warn('sync_missing_profiles_from_auth unexpected error:', error);
      }
    }

    if (
      canUseCache &&
      filterCache &&
      filterCache.key === cacheKey &&
      Date.now() - filterCache.at < FILTER_CACHE_TTL_MS
    ) {
      setTeams(filterCache.teams);
      setUsers(filterCache.users);
      const managerEffectiveTeamId =
        isManager
          ? (filterCache.users.find((row) => row.id === profile.id)?.team_id ?? profile.team_id ?? null)
          : (profile.team_id ?? null);
      applyRoleDefaultSelection(managerEffectiveTeamId);
      setLoadingFilters(false);
      perfEnd('data.filters');
      return;
    }
    
    const loadTeams = async (scopedTeamId: string | null) => {
      if (isAdmin) {
        return await supabase.from('teams').select('id,name,created_at').order('name');
      }
      if (scopedTeamId) {
        return await supabase.from('teams').select('id,name,created_at').eq('id', scopedTeamId).order('name');
      }
      return { data: [], error: null } as { data: unknown[]; error: null };
    };

    const loadUsers = async () => {
      const scopedResult = (isAdmin || isManager)
        ? await supabase.rpc('get_team_management_profiles_v2')
        : await supabase.rpc('get_visible_profiles');
      const {
        data,
        error,
      } = (!scopedResult.error || !isAdmin && !isManager)
        ? scopedResult
        : await supabase.rpc('get_team_management_profiles');
      if (!error) {
        const rows = (data ?? []) as Profile[];
        if (isManager && profile.team_id && rows.length === 0) {
          return await supabase
            .from('profiles')
            .select('id,email,full_name,avatar_url,role,team_id,created_at')
            .eq('team_id', profile.team_id)
            .order('full_name');
        }
        return { data: rows, error: null };
      }

      if (isAdmin) {
        return await supabase
          .from('profiles')
          .select('id,email,full_name,avatar_url,role,team_id,created_at')
          .order('full_name');
      }
      if (isManager && profile.team_id) {
        return await supabase
          .from('profiles')
          .select('id,email,full_name,avatar_url,role,team_id,created_at')
          .eq('team_id', profile.team_id)
          .order('full_name');
      }
      return await supabase
        .from('profiles')
        .select('id,email,full_name,avatar_url,role,team_id,created_at')
        .eq('id', profile.id)
        .order('full_name');
    };

    const usersResult = await loadUsers();
    const nextUsers = ((usersResult.data ?? []) as Profile[]);
    const managerEffectiveTeamId =
      isManager
        ? (nextUsers.find((row) => row.id === profile.id)?.team_id ?? profile.team_id ?? null)
        : (profile.team_id ?? null);
    const teamsResult = await loadTeams(managerEffectiveTeamId);

    const nextTeams = ((teamsResult.data ?? []) as Team[]);
    setTeams(nextTeams);
    setUsers(nextUsers);
    if (canUseCache) {
      filterCache = {
        key: cacheKey,
        at: Date.now(),
        teams: nextTeams,
        users: nextUsers,
      };
    }

    applyRoleDefaultSelection(managerEffectiveTeamId);

    setLoadingFilters(false);
    perfEnd('data.filters');
  }, [applyRoleDefaultSelection, isAdmin, isManager, profile]);

  useEffect(() => {
    const profileId = profile?.id;
    if (!profileId) return;

    const channel = supabase
      .channel(`data-context-profile-${profileId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'profiles', filter: `id=eq.${profileId}` },
        () => {
          void loadFilterData();
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [loadFilterData, profile?.id]);

  const setTeamFilter = (id: string | 'all') => {
      setSelectedTeamId(id);
      setSelectedUserId('all'); // Reset user when team changes
  };

  const setUserFilter = (id: string | 'all') => {
      setSelectedUserId(id);
  };

  // Compute users available in the second dropdown
  const filteredUsers = users.filter(u => {
      if (selectedTeamId === 'all') return true;
      return u.team_id === selectedTeamId;
  });

  return (
    <DataContext.Provider value={{
      teams,
      users,
      selectedTeamId,
      selectedUserId,
      setTeamFilter,
      setUserFilter,
      filteredUsers,
      loadingFilters
    }}>
      {children}
    </DataContext.Provider>
  );
};

export const useData = () => useContext(DataContext);
