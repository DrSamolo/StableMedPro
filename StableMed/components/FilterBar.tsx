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
    <div className="flex items-center gap-4 mb-6 bg-white p-3 rounded-lg border border-border shadow-sm w-fit">
      <div className="flex items-center gap-2 text-sm font-medium text-secondary border-r border-border pr-4">
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
                    className="bg-transparent text-sm font-medium text-primary outline-none cursor-pointer min-w-[120px]"
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
      <div className="relative group border-l border-border pl-4">
        <div className="flex items-center gap-2">
             <User size={14} className="text-gray-400" />
             <select 
                value={selectedUserId} 
                onChange={(e) => setUserFilter(e.target.value)}
                className="bg-transparent text-sm font-medium text-primary outline-none cursor-pointer min-w-[150px]"
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
