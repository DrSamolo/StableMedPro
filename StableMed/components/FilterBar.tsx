import React from 'react';
import { Filter, Users, User } from 'lucide-react';
import { useData } from '../contexts/DataContext';
import { useAuth } from '../contexts/AuthContext';
import { CustomSelect } from './Common';

export const FilterBar: React.FC<{ className?: string }> = ({ className = '' }) => {
  const { profile } = useAuth();
  const { 
      teams, 
      selectedTeamId, 
      setTeamFilter, 
      filteredUsers, 
      selectedUserId, 
      setUserFilter,
      loadingFilters 
  } = useData();

  // If Commercial, don't show filters (they only see their data)
  if (profile?.role === 'commercial') return null;

  const teamOptions = [
    { value: 'all', label: 'Toutes les equipes' },
    ...teams.map((team) => ({ value: team.id, label: team.name })),
  ];

  const userOptions = [
    { value: 'all', label: 'Tous les commerciaux' },
    ...filteredUsers.map((currentUser) => ({
      value: currentUser.id,
      label: currentUser.full_name || currentUser.email || 'Utilisateur',
    })),
  ];

  return (
    <div className={`flex w-full flex-wrap items-start gap-2 rounded-md border border-border bg-white px-3 py-2 shadow-sm sm:items-center ${className}`}>
      <div className="flex h-9 items-center gap-2 pr-2 text-sm font-medium text-secondary sm:border-r sm:border-border sm:pr-3">
        <Filter size={16} />
        <span>Vue</span>
      </div>

      {/* Team Filter - Only for Admin */}
      {profile?.role === 'admin' && (
        <div className="w-full sm:min-w-[210px] sm:w-auto">
          <CustomSelect
            value={selectedTeamId}
            onChange={setTeamFilter}
            options={teamOptions}
            icon={Users}
            minWidth="210px"
            className={loadingFilters ? 'pointer-events-none opacity-60' : ''}
          />
        </div>
      )}

      {/* User Filter - For Admin & Manager */}
      <div className="w-full pl-0 sm:w-auto sm:border-l sm:border-border sm:pl-3">
        <CustomSelect
          value={selectedUserId}
          onChange={setUserFilter}
          options={userOptions}
          icon={User}
          minWidth="240px"
          className={loadingFilters ? 'pointer-events-none opacity-60' : ''}
        />
      </div>
    </div>
  );
};
