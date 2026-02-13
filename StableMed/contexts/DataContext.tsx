import React, { createContext, useContext, useState, useEffect } from 'react';
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

  const loadFilterData = async () => {
    if (!profile) return;
    perfStart('data.filters');
    const cacheKey = `${profile.role}:${profile.team_id ?? 'none'}:${profile.id}`;

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
      !isAdmin &&
      filterCache &&
      filterCache.key === cacheKey &&
      Date.now() - filterCache.at < FILTER_CACHE_TTL_MS
    ) {
      setTeams(filterCache.teams);
      setUsers(filterCache.users);
      setLoadingFilters(false);
      perfEnd('data.filters');
      return;
    }
    
    const loadTeams = async () => {
      if (isAdmin) {
        return await supabase.from('teams').select('id,name,created_at').order('name');
      }
      if (profile.team_id) {
        return await supabase.from('teams').select('id,name,created_at').eq('id', profile.team_id).order('name');
      }
      return { data: [], error: null } as { data: unknown[]; error: null };
    };

    const loadUsers = async () => {
      const { data, error } = await supabase.rpc('get_visible_profiles');
      if (!error) {
        return { data: (data ?? []) as Profile[], error: null };
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

    const [teamsResult, usersResult] = await Promise.all([loadTeams(), loadUsers()]);

    const nextTeams = ((teamsResult.data ?? []) as Team[]);
    const nextUsers = ((usersResult.data ?? []) as Profile[]);
    setTeams(nextTeams);
    setUsers(nextUsers);
    filterCache = {
      key: cacheKey,
      at: Date.now(),
      teams: nextTeams,
      users: nextUsers,
    };

    // Default Selection Logic
    if (normalizedRole === 'commercial') {
        setSelectedUserId(profile.id); // Locked to self
        if (profile.team_id) setSelectedTeamId(profile.team_id);
    } else if (isManager && profile.team_id) {
        setSelectedTeamId(profile.team_id); // Locked to own team
    }

    setLoadingFilters(false);
    perfEnd('data.filters');
  };

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
