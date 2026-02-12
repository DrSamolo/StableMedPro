import React from 'react';
import { Filter, Users, User } from 'lucide-react';
import { useData } from '../contexts/DataContext';
import { useAuth } from '../contexts/AuthContext';

export const FilterBar: React.FC = () => {
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

  return (
    <div className="mb-6 flex w-fit flex-wrap items-center gap-3 rounded-xl border border-border bg-white px-3 py-2.5 shadow-sm">
      <div className="flex items-center gap-2 border-r border-border pr-3 text-sm font-medium text-secondary">
        <Filter size={16} />
        <span>Vue :</span>
      </div>

      {/* Team Filter - Only for Admin */}
      {profile?.role === 'admin' && (
        <div className="relative group">
            <div className="flex items-center gap-2">
                <Users size={14} className="text-gray-400" />
                <select 
                    value={selectedTeamId} 
                    onChange={(e) => setTeamFilter(e.target.value)}
                    className="ui-focus cursor-pointer rounded-md border border-transparent bg-transparent px-1 py-1 text-sm font-medium text-primary min-w-[120px]"
                    disabled={loadingFilters}
                >
                    <option value="all">Toutes les équipes</option>
                    {teams.map(t => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                </select>
            </div>
        </div>
      )}

      {/* User Filter - For Admin & Manager */}
      <div className="relative group border-l border-border pl-3">
        <div className="flex items-center gap-2">
             <User size={14} className="text-gray-400" />
             <select 
                value={selectedUserId} 
                onChange={(e) => setUserFilter(e.target.value)}
                className="ui-focus cursor-pointer rounded-md border border-transparent bg-transparent px-1 py-1 text-sm font-medium text-primary min-w-[150px]"
                disabled={loadingFilters}
            >
                <option value="all">Tous les commerciaux</option>
                {filteredUsers.map(u => (
                    <option key={u.id} value={u.id}>{u.full_name || u.email}</option>
                ))}
            </select>
        </div>
      </div>
    </div>
  );
};
