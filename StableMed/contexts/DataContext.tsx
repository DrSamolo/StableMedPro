import React, { createContext, useContext, useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { Profile, Team } from '../types';
import { useAuth } from './AuthContext';

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

export const DataProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { profile } = useAuth();
  const [teams, setTeams] = useState<Team[]>([]);
  const [users, setUsers] = useState<Profile[]>([]);
  
  const [selectedTeamId, setSelectedTeamId] = useState<string | 'all'>('all');
  const [selectedUserId, setSelectedUserId] = useState<string | 'all'>('all');
  const [loadingFilters, setLoadingFilters] = useState(true);

  // Initialize filters based on Role
  useEffect(() => {
    if (profile) {
      loadFilterData();
    }
  }, [profile]);

  const loadFilterData = async () => {
    setLoadingFilters(true);
    
    // Fetch Teams
    const { data: teamsData } = await supabase.from('teams').select('*').order('name');
    if (teamsData) setTeams(teamsData as Team[]);

    // Fetch Users with Team info
    const { data: usersData } = await supabase.from('profiles').select('*, team:teams(id, name)').order('full_name');
    if (usersData) setUsers(usersData as Profile[]);

    // Default Selection Logic
    if (profile?.role === 'commercial') {
        setSelectedUserId(profile.id); // Locked to self
        if (profile.team_id) setSelectedTeamId(profile.team_id);
    } else if (profile?.role === 'manager' && profile.team_id) {
        setSelectedTeamId(profile.team_id); // Locked to own team
    }

    setLoadingFilters(false);
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
