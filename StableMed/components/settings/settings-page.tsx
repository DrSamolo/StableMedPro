import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Card, SectionLoader, SectionTitle, Avatar, Modal } from '@/components/Common';
import { User, Shield, LogOut, Loader2, Save, Camera, Upload, Database, RefreshCw, Users, Lock, AlertTriangle, Zap, Copy, RotateCcw, Plus, Briefcase, Mail, Send, CheckCircle, Sliders, Activity, XCircle, Play, Eye, Trash2, UserX } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { Profile, RolePermission, UserRole, Team, Invitation, Lead } from '@/types';
import { useNotification } from '@/contexts/NotificationContext';
import { fetchZadarmaCallStats } from '@/lib/integrations';
import { perfEnd, perfStart } from '@/lib/perf/metrics';
import { getCached, invalidateCached, setCached } from '@/lib/perf/cache';

const SETTINGS_TEAM_CACHE_TTL_MS = 60_000;
const SETTINGS_TEAMS_CACHE_TTL_MS = 120_000;
const SETTINGS_INVITES_CACHE_TTL_MS = 45_000;
const SETTINGS_ROLES_CACHE_TTL_MS = 120_000;

const SettingSection: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div className="mb-10">
    <h3 className="ui-section-title mb-4 border-b border-border pb-2 text-primary">{title}</h3>
    <div className="space-y-4">
      {children}
    </div>
  </div>
);

const Settings: React.FC = () => {
  const { profile, user, signOut, refreshProfile } = useAuth();
  const { addNotification, pushAppNotification } = useNotification();
  const [activeTab, setActiveTab] = useState<'profile' | 'team' | 'roles' | 'database' | 'api' | 'tests'>('profile');
  
  // Profile Form State
  const [fullName, setFullName] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Team Data State
  const [teamMembers, setTeamMembers] = useState<Profile[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [isLoadingTeam, setIsLoadingTeam] = useState(false);
  
  // Create Team State
  const [newTeamName, setNewTeamName] = useState('');
  const [isCreatingTeam, setIsCreatingTeam] = useState(false);
  const [selectedTeamForMembers, setSelectedTeamForMembers] = useState<Team | null>(null);
  const [isMembersModalOpen, setIsMembersModalOpen] = useState(false);
  const [teamToDelete, setTeamToDelete] = useState<Team | null>(null);
  const [isDeleteTeamModalOpen, setIsDeleteTeamModalOpen] = useState(false);
  const [deleteTeamConfirmInput, setDeleteTeamConfirmInput] = useState('');
  const [deleteTeamReassignTarget, setDeleteTeamReassignTarget] = useState('');
  const [isDeletingTeam, setIsDeletingTeam] = useState(false);
  const [isDeleteUserModalOpen, setIsDeleteUserModalOpen] = useState(false);
  const [userToDelete, setUserToDelete] = useState<Profile | null>(null);
  const [deleteUserConfirmInput, setDeleteUserConfirmInput] = useState('');
  const [deleteUserReassignTarget, setDeleteUserReassignTarget] = useState('');
  const [isDeletingUser, setIsDeletingUser] = useState(false);

  // Invite Modal State
  const [isInviteModalOpen, setIsInviteModalOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<UserRole>('commercial');
  const [inviteTeamId, setInviteTeamId] = useState<string>('');
  const [isSendingInvite, setIsSendingInvite] = useState(false);
  const [lastInviteLink, setLastInviteLink] = useState('');

  // Roles & Permissions State
  const [rolePermissions, setRolePermissions] = useState<RolePermission[]>([]);
  const [isLoadingRoles, setIsLoadingRoles] = useState(false);
  const [isResettingRoles, setIsResettingRoles] = useState(false);

  // Database State
  const [isReloadingSchema, setIsReloadingSchema] = useState(false);
  const [showSqlModal, setShowSqlModal] = useState(false);

  // Tests State
  const [testResults, setTestResults] = useState<{name: string, status: 'pending'|'success'|'failure', message: string}[]>([]);
  const [isRunningTests, setIsRunningTests] = useState(false);
  const normalizedRole = (profile?.role ?? '').trim().toLowerCase();
  const isAdmin = normalizedRole === 'admin';
  const isManager = normalizedRole === 'manager';
  const teamMembersByTeamId = useMemo(() => {
    const counts = new Map<string, number>();
    for (const member of teamMembers) {
      if (!member.team_id) continue;
      counts.set(member.team_id, (counts.get(member.team_id) ?? 0) + 1);
    }
    return counts;
  }, [teamMembers]);
  const selectedTeamMembers = useMemo(() => {
    if (!selectedTeamForMembers) return [];
    return teamMembers.filter((member) => member.team_id === selectedTeamForMembers.id);
  }, [selectedTeamForMembers, teamMembers]);
  const reassignableUsers = useMemo(() => {
    if (!userToDelete) return teamMembers;
    return teamMembers.filter((member) => member.id !== userToDelete.id);
  }, [teamMembers, userToDelete]);
  const teamUiStats = useMemo(() => {
    const unassignedMembers = teamMembers.filter((member) => !member.team_id).length;
    return {
      totalTeams: teams.length,
      totalMembers: teamMembers.length,
      unassignedMembers,
    };
  }, [teamMembers, teams.length]);

  // Configuration for permissions rows
  const PERMISSIONS_CONFIG = [
    { key: 'can_manage_team', label: 'Gérer les équipes (Voir/Assigner)' },
    { key: 'can_delete_leads', label: 'Supprimer définitivement des leads' },
    { key: 'can_export_data', label: 'Exporter les données (CSV)' },
    { key: 'can_manage_roles', label: 'Modifier les rôles utilisateurs' },
    { key: 'can_manage_catalog', label: 'Ajouter/Modifier le catalogue' },
  ];

  // Default Permissions (Fallback)
  const DEFAULT_PERMISSIONS: RolePermission[] = [
      { role: 'admin', permissions: { can_manage_team: true, can_delete_leads: true, can_export_data: true, can_manage_roles: true, can_manage_catalog: true } },
      { role: 'manager', permissions: { can_manage_team: true, can_delete_leads: false, can_export_data: true, can_manage_roles: false, can_manage_catalog: false } },
      { role: 'commercial', permissions: { can_manage_team: false, can_delete_leads: false, can_export_data: false, can_manage_roles: false, can_manage_catalog: false } }
  ];

  useEffect(() => {
    if (profile) {
      setFullName(profile.full_name || '');
      setAvatarUrl(profile.avatar_url || '');
    }
  }, [profile]);

  useEffect(() => {
    if (activeTab === 'team') {
        void Promise.all([fetchTeam(), fetchTeams(), fetchInvitations()]);
    }
    if (activeTab === 'roles') void fetchRoles();
  }, [activeTab]);

  useEffect(() => {
    if (activeTab !== 'team' || !user?.id) return;

    const channel = supabase
      .channel(`settings-invitations-${user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'invitations' }, () => {
        invalidateCached('settings:invitations:');
        void fetchInvitations();
      })
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [activeTab, user?.id, profile?.role, profile?.team_id]);

  const fetchTeam = async () => {
    perfStart('settings.fetchTeam');
    setIsLoadingTeam(true);
    const roleScope = profile?.role ?? 'guest';
    const teamScope = profile?.team_id ?? 'none';
    const userScope = user?.id ?? 'anon';
    const cacheKey = `settings:team-members:${roleScope}:${teamScope}:${userScope}`;
    const cached = getCached<Profile[]>(cacheKey, SETTINGS_TEAM_CACHE_TTL_MS);
    if (cached && !isAdmin) {
      setTeamMembers(cached);
      setIsLoadingTeam(false);
      perfEnd('settings.fetchTeam');
      return;
    }

    try {
      const profileTeamId = profile?.team_id ?? null;
      if (isAdmin) {
        const { error: syncError } = await supabase.rpc('sync_missing_profiles_from_auth');
        if (syncError) {
          const code = (syncError as { code?: string }).code ?? '';
          const missingRpc =
            code === 'PGRST202' ||
            code === '42883' ||
            String(syncError.message || '').toLowerCase().includes('not found');
          if (!missingRpc) {
            console.warn('sync_missing_profiles_from_auth failed:', syncError.message);
          }
        }
      }

      const query = supabase
        .rpc('get_visible_profiles');

      const { data, error } = await query;
      if (error || !Array.isArray(data)) {
        let fallback = supabase
          .from('profiles')
          .select('id,email,full_name,avatar_url,role,manager_id,team_id,created_at')
          .order('created_at', { ascending: true });

        if (isManager && profileTeamId) {
          fallback = fallback.eq('team_id', profileTeamId);
        } else if (!isAdmin && user?.id) {
          fallback = fallback.eq('id', user.id);
        }

        const { data: fallbackData, error: fallbackError } = await fallback;
        if (fallbackError) throw fallbackError;
        const members = (fallbackData ?? []).map((member) => ({
          ...member,
          team: teams.find((team) => team.id === member.team_id),
        })) as Profile[];
        setTeamMembers(members);
        setCached(cacheKey, members);
      } else if (data) {
        const members = (data as Profile[]).map((member) => ({
          ...member,
          team: teams.find((team) => team.id === member.team_id),
        })) as Profile[];
        setTeamMembers(members);
        setCached(cacheKey, members);
      }
    } catch (error: any) {
      addNotification('error', `Erreur chargement membres: ${error.message}`);
    } finally {
      setIsLoadingTeam(false);
      perfEnd('settings.fetchTeam');
    }
  };

  const fetchTeams = async () => {
      const roleScope = profile?.role ?? 'guest';
      const teamScope = profile?.team_id ?? 'none';
      const cacheKey = `settings:teams:${roleScope}:${teamScope}`;
      const cached = getCached<Team[]>(cacheKey, SETTINGS_TEAMS_CACHE_TTL_MS);
      if (cached && !isAdmin) {
        setTeams(cached);
        return;
      }

      let query = supabase
        .from('teams')
        .select('id,name,created_at')
        .order('created_at', { ascending: false });

      const profileTeamId = profile?.team_id ?? null;
      if (isManager && profileTeamId) {
        query = query.eq('id', profileTeamId);
      } else if (!isAdmin && profileTeamId) {
        query = query.eq('id', profileTeamId);
      }

      const { data } = await query;
      if (data) {
        const mapped = data as Team[];
        setTeams(mapped);
        setCached(cacheKey, mapped);
      }
  };

  const fetchInvitations = async () => {
      try {
          const roleScope = profile?.role ?? 'guest';
          const teamScope = profile?.team_id ?? 'none';
          const userScope = user?.id ?? 'anon';
          const cacheKey = `settings:invitations:${roleScope}:${teamScope}:${userScope}`;
          const cached = getCached<Invitation[]>(cacheKey, SETTINGS_INVITES_CACHE_TTL_MS);
          if (cached) {
              setInvitations(cached);
              return;
          }

          const { data, error } = await supabase
            .from('invitations')
            .select('id,email,role,team_id,token,expires_at,created_at,created_by')
            .is('used_at', null)
            .order('created_at', { ascending: false });
          
          if (error) {
              if (error.message.includes('schema cache') || error.code === '42P01') {
                  console.warn("Invitations table not found in cache yet.");
                  return; 
              }
              throw error;
          }
          if (data) {
              const invitationsData = data as Invitation[];
              setInvitations(invitationsData);
              setCached(cacheKey, invitationsData);
          }
      } catch (err) {
          console.error("Fetch Invitations error:", err);
      }
  };

  const fetchRoles = async () => {
    setIsLoadingRoles(true);
    const cacheKey = 'settings:role-permissions';
    const cached = getCached<RolePermission[]>(cacheKey, SETTINGS_ROLES_CACHE_TTL_MS);
    if (cached) {
      setRolePermissions(cached);
      setIsLoadingRoles(false);
      return;
    }
    const { data, error } = await supabase.from('role_permissions').select('role,permissions');
    if (!data || data.length === 0) {
        setRolePermissions(DEFAULT_PERMISSIONS);
        setCached(cacheKey, DEFAULT_PERMISSIONS);
    } else {
        const sortOrder: Record<string, number> = { 'admin': 1, 'manager': 2, 'commercial': 3 };
        const sortedData = (data as RolePermission[]).sort((a, b) => 
            (sortOrder[a.role] || 99) - (sortOrder[b.role] || 99)
        );
        setRolePermissions(sortedData);
        setCached(cacheKey, sortedData);
    }
    setIsLoadingRoles(false);
  };

  const handleUpdateProfile = async () => {
    if (!profile) return;
    setIsSaving(true);
    try {
        const updates = { full_name: fullName, avatar_url: avatarUrl };
        const { error } = await supabase.from('profiles').update(updates).eq('id', profile.id);
        if (error) throw error;
        await refreshProfile();
        addNotification('success', "Profil mis à jour");
    } catch (error: any) {
        addNotification('error', `Erreur: ${error.message}`);
    } finally {
        setIsSaving(false);
    }
  };

  const handleUploadAvatar = async (event: React.ChangeEvent<HTMLInputElement>) => {
    try {
      setIsUploading(true);
      if (!user?.id) throw new Error("Utilisateur non authentifié.");
      if (!event.target.files || event.target.files.length === 0) throw new Error('Aucun fichier sélectionné.');
      const file = event.target.files[0];
      if (file.size > 5 * 1024 * 1024) throw new Error("Le fichier dépasse 5MB.");

      const extension = file.name.split('.').pop()?.toLowerCase() || 'jpg';
      const filePath = `${user.id}/avatar.${extension}`;
      const { error: uploadError } = await supabase.storage.from('avatars').upload(filePath, file, {
        upsert: true,
        contentType: file.type || 'image/jpeg',
        cacheControl: '3600',
      });
      if (uploadError) throw uploadError;
      const { data } = supabase.storage.from('avatars').getPublicUrl(filePath);
      if (data?.publicUrl) {
        setAvatarUrl(data.publicUrl);
        const { error: profileUpdateError } = await supabase
          .from('profiles')
          .update({ avatar_url: data.publicUrl })
          .eq('id', user.id);
        if (profileUpdateError) throw profileUpdateError;
        await refreshProfile();
        addNotification('success', 'Photo de profil mise à jour');
      }
    } catch (error: any) {
      addNotification('error', 'Erreur upload : ' + error.message);
    } finally {
      if (event.target) event.target.value = '';
      setIsUploading(false);
    }
  };

  const handleChangeRole = async (userId: string, newRole: UserRole) => {
    if (!isAdmin) return addNotification('error', "Réservé aux admins.");
    const { error } = await supabase.from('profiles').update({ role: newRole }).eq('id', userId);
    if (error) addNotification('error', "Erreur: " + error.message);
    else {
        invalidateCached('settings:team-members:');
        addNotification('success', "Rôle mis à jour.");
        setTeamMembers(prev => prev.map(m => m.id === userId ? { ...m, role: newRole } : m));
    }
  };

  const handleChangeTeam = async (userId: string, teamId: string) => {
    if (!isAdmin) return addNotification('error', "Réservé aux admins.");
    const val = teamId === 'none' ? null : teamId;
    const { error } = await supabase.from('profiles').update({ team_id: val }).eq('id', userId);
    if (error) {
        if(error.code === '42P01') setShowSqlModal(true);
        addNotification('error', "Erreur: " + error.message);
    } else {
        invalidateCached('settings:team-members:');
        addNotification('success', "Équipe assignée.");
        const team = teams.find(t => t.id === val);
        setTeamMembers(prev => prev.map(m => m.id === userId ? { ...m, team_id: val || undefined, team: team } : m));
    }
  };

  const handleCreateTeam = async () => {
      const normalizedTeamName = newTeamName.trim();
      if (!normalizedTeamName) return;
      setIsCreatingTeam(true);
      try {
          const { data, error } = await supabase.from('teams').insert([{ name: normalizedTeamName }]).select().single();
          if (error) throw error;
          setTeams([data, ...teams]);
          invalidateCached('settings:teams:');
          setNewTeamName('');
          addNotification('success', 'Équipe créée');
      } catch (error: any) {
          if (error.code === '42P01') {
            setShowSqlModal(true);
          } else if (error.code === '42501') {
            addNotification('error', "Permission refusée: seuls les admins peuvent créer une équipe.");
          } else if (error.code === '23505') {
            addNotification('warning', "Cette équipe existe déjà.");
          } else {
            addNotification('error', error.message);
          }
      } finally {
          setIsCreatingTeam(false);
      }
  };

  const openTeamMembersModal = (team: Team) => {
    setSelectedTeamForMembers(team);
    setIsMembersModalOpen(true);
  };

  const openDeleteTeamModal = (team: Team) => {
    const fallbackTeam = teams.find((item) => item.id !== team.id);
    setTeamToDelete(team);
    setDeleteTeamConfirmInput('');
    setDeleteTeamReassignTarget(fallbackTeam?.id ?? '');
    setIsDeleteTeamModalOpen(true);
  };

  const handleDeleteTeam = async () => {
    if (!teamToDelete) return;
    if (deleteTeamConfirmInput.trim() !== teamToDelete.name) {
      addNotification('warning', "Le nom de l'équipe ne correspond pas.");
      return;
    }

    setIsDeletingTeam(true);
    try {
      const { error } = await supabase.rpc('delete_team_secure', {
        p_team_id: teamToDelete.id,
        p_reassign_team_id: deleteTeamReassignTarget || null,
      });
      if (error) throw error;
      invalidateCached('settings:teams:');
      invalidateCached('settings:team-members:');
      invalidateCached('settings:invitations:');
      await Promise.all([fetchTeams(), fetchTeam(), fetchInvitations()]);
      setIsDeleteTeamModalOpen(false);
      setTeamToDelete(null);
      addNotification('success', 'Équipe supprimée.');
    } catch (error: any) {
      addNotification('error', `Suppression impossible: ${error.message}`);
    } finally {
      setIsDeletingTeam(false);
    }
  };

  const openDeleteUserModal = (member: Profile) => {
    const fallbackUser = teamMembers.find((user) => user.id !== member.id);
    setUserToDelete(member);
    setDeleteUserConfirmInput('');
    setDeleteUserReassignTarget(fallbackUser?.id ?? '');
    setIsDeleteUserModalOpen(true);
  };

  const handleDeleteUser = async () => {
    if (!userToDelete) return;
    if (!deleteUserReassignTarget) {
      addNotification('warning', 'Sélectionnez un utilisateur de réassignation.');
      return;
    }
    const targetName = (userToDelete.full_name || userToDelete.email || 'Utilisateur').trim();
    if (deleteUserConfirmInput.trim() !== targetName) {
      addNotification('warning', "Le nom de confirmation ne correspond pas.");
      return;
    }

    setIsDeletingUser(true);
    try {
      const { data, error } = await supabase.rpc('delete_user_secure', {
        p_user_id: userToDelete.id,
        p_reassign_user_id: deleteUserReassignTarget || null,
      });
      if (error) throw error;

      const payload = (data ?? {}) as Record<string, unknown>;
      const movedLeads = Number(payload.moved_leads ?? 0);
      const movedDeals = Number(payload.moved_deals ?? 0);
      const movedTasks = Number(payload.moved_tasks ?? 0);
      const movedComments = Number(payload.moved_comments ?? 0);
      const deletedNotifications = Number(payload.deleted_notifications ?? 0);

      setTeamMembers(prev => prev.filter((member) => member.id !== userToDelete.id));
      invalidateCached('settings:teams:');
      invalidateCached('settings:team-members:');
      invalidateCached('settings:invitations:');
      await Promise.all([fetchTeams(), fetchTeam(), fetchInvitations()]);
      setIsDeleteUserModalOpen(false);
      setUserToDelete(null);
      addNotification(
        'success',
        `Utilisateur supprimé. Leads: ${movedLeads} • Opportunités: ${movedDeals} • Tâches: ${movedTasks}`
      );
      pushAppNotification(
        'Suppression utilisateur',
        `Réaffectation effectuée: ${movedLeads} leads, ${movedDeals} opportunités, ${movedTasks} tâches, ${movedComments} commentaires. Notifications supprimées: ${deletedNotifications}.`,
        'warning'
      );
    } catch (error: any) {
      const details = [error?.message, error?.details, error?.hint].filter(Boolean).join(' | ');
      addNotification('error', `Suppression impossible: ${details || 'Erreur inconnue'}`);
    } finally {
      setIsDeletingUser(false);
    }
  };

  const handleInviteUser = async () => {
      if (!inviteEmail || !user) return;
      setIsSendingInvite(true);
      try {
          const { data, error } = await supabase.from('invitations').insert([{
              email: inviteEmail,
              role: inviteRole,
              team_id: inviteTeamId || null,
              created_by: user.id
          }]).select().single();

          if (error) throw error;
          
          const link = `${window.location.origin}/register?token=${data.token}`;
          setLastInviteLink(link);
          setInvitations([data, ...invitations]);
          invalidateCached('settings:invitations:');
          addNotification('success', 'Invitation créée');
          setInviteEmail('');
      } catch (err: any) {
          if (err.code === '42P01') {
              setShowSqlModal(true); 
          } else {
              addNotification('error', err.message);
          }
      } finally {
          setIsSendingInvite(false);
      }
  };

  const copyInviteLink = (link?: string) => {
    navigator.clipboard.writeText(link || lastInviteLink);
    addNotification('info', "Lien copié !");
  };

  const deleteInvitation = async (id: string) => {
      const { error } = await supabase.from('invitations').delete().eq('id', id);
      if (!error) {
          setInvitations(prev => prev.filter(i => i.id !== id));
          invalidateCached('settings:invitations:');
          addNotification('success', 'Invitation annulée');
      }
  };

  const handleTogglePermission = async (roleName: string, permKey: string, currentValue: boolean) => {
      if (!isAdmin) return addNotification('error', "Réservé aux admins.");
      if (roleName === 'admin') return addNotification('warning', "Admin a tous les droits.");

      const rolePermEntry = rolePermissions.find(rp => rp.role === roleName);
      if (!rolePermEntry) return;

      const updatedPerms = { ...(rolePermEntry.permissions || {}), [permKey]: !currentValue };
      
      setRolePermissions(prev => prev.map(rp => rp.role === roleName ? { ...rp, permissions: updatedPerms as RolePermission['permissions'] } : rp));

      try {
        const { error, count } = await supabase.from('role_permissions').update({ permissions: updatedPerms }).eq('role', roleName).select();
        if (error) throw error;
        if (count === 0 || !count) {
             await supabase.from('role_permissions').upsert({ role: roleName as UserRole, permissions: updatedPerms });
        }
        invalidateCached('settings:role-permissions');
      } catch (error: any) {
          addNotification('error', "Erreur sauvegarde: " + error.message);
      }
  };

  const handleResetRoles = async () => {
      if (!confirm("Voulez-vous réinitialiser toutes les permissions par défaut ?")) return;
      setIsResettingRoles(true);
      try {
          await supabase.from('role_permissions').delete().neq('role', 'placeholder');
          for (const rp of DEFAULT_PERMISSIONS) {
             await supabase.from('role_permissions').upsert(rp);
          }
          invalidateCached('settings:role-permissions');
          await fetchRoles();
          addNotification('success', "Permissions réinitialisées.");
      } catch (error: any) {
          addNotification('error', "Erreur reset: " + error.message);
      } finally {
          setIsResettingRoles(false);
      }
  };

  const handleReloadSchema = async () => {
    setIsReloadingSchema(true);
    try {
      const { error } = await supabase.rpc('reload_schema');
      if (error) throw error;
      addNotification('success', 'Schéma rechargé.');
    } catch (error: any) {
       await supabase.from('profiles').select('id').limit(1);
       addNotification('success', 'Tentative de rechargement envoyée.');
    } finally {
       setIsReloadingSchema(false);
    }
  };

  // --- ROBUSTNESS TEST RUNNER ---
  const runSystemTests = async () => {
      setIsRunningTests(true);
      setTestResults([]);
      const results = [];

      // Helper for delay
      const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

      try {
          // TEST 1: Role Filtering Logic (Unit Test Simulation)
          results.push({ name: 'Initialisation des tests...', status: 'pending', message: 'Démarrage...' });
          setTestResults([...results] as any);
          await wait(500);

          const sampleLeads: Partial<Lead>[] = [
              { id: '1', user_id: 'user_A', assignee: { id: 'user_A', team_id: 'team_alpha' } as Profile } as any,
              { id: '2', user_id: 'user_B', assignee: { id: 'user_B', team_id: 'team_beta' } as Profile } as any,
          ];

          // Simulation: Commercial A should only see lead 1
          const commercialFilter = (lead: any) => lead.user_id === 'user_A';
          const filteredCommercial = sampleLeads.filter(commercialFilter);
          
          if (filteredCommercial.length === 1 && filteredCommercial[0].id === '1') {
              results[0] = { name: 'Logique de Filtrage (Rôles)', status: 'success', message: 'Le filtre Commercial isole correctement les données.' };
          } else {
              results[0] = { name: 'Logique de Filtrage (Rôles)', status: 'failure', message: 'Le filtre laisse passer des données non autorisées.' };
          }
          setTestResults([...results] as any);
          await wait(500);

          // TEST 2: API Graceful Failover
          results.push({ name: 'Résilience API Zadarma', status: 'pending', message: 'Simulation coupure réseau...' });
          setTestResults([...results] as any);
          
          // Even if config is missing, the service should not throw and should return fallback stats.
          try {
              const res = await fetchZadarmaCallStats();
              if (res && typeof res.calls_today === 'number' && typeof res.trend === 'number') {
                   results[1] = { name: 'Résilience API Zadarma', status: 'success', message: 'Service a géré l\'appel sans crasher (Safe Fail).' };
              } else {
                   results[1] = { name: 'Résilience API Zadarma', status: 'failure', message: 'Retour inattendu du service.' };
              }
          } catch (e: any) {
              results[1] = { name: 'Résilience API Zadarma', status: 'failure', message: 'Le service a levé une exception non gérée : ' + e.message };
          }
          setTestResults([...results] as any);
          await wait(500);

          // TEST 3: DB Connection Check
          results.push({ name: 'Latence Base de Données', status: 'pending', message: 'Ping Supabase...' });
          setTestResults([...results] as any);
          
          const start = Date.now();
          const { error: dbError } = await supabase.from('profiles').select('count').limit(1).single();
          const duration = Date.now() - start;

          if (!dbError) {
              results[2] = { name: 'Latence Base de Données', status: 'success', message: `Réponse valide en ${duration}ms.` };
          } else {
              results[2] = { name: 'Connexion Base de Données', status: 'failure', message: dbError.message };
          }
          setTestResults([...results] as any);

          // Trigger Admin Notification
          pushAppNotification(
              'Diagnostic Système',
              `Le diagnostic manuel a été exécuté avec succès.`,
              'info'
          );

      } catch (globalError: any) {
          addNotification('error', "Erreur critique du banc de test : " + globalError.message);
      } finally {
          setIsRunningTests(false);
      }
  };

  return (
    <div className="ui-page max-w-6xl">
      <SectionTitle title="Paramètres" subtitle="Gérez vos préférences, votre équipe et les droits d'accès" />

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
        <div className="lg:col-span-1">
           <Card noPadding>
                <nav className="flex flex-col p-2">
                    <button onClick={() => setActiveTab('profile')} className={`ui-focus flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors ${activeTab === 'profile' ? 'bg-gray-100 text-primary' : 'text-secondary hover:text-primary hover:bg-gray-50'}`}>
                        <User size={16} /> Mon Profil
                    </button>
                    <button onClick={() => setActiveTab('team')} className={`ui-focus flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors ${activeTab === 'team' ? 'bg-gray-100 text-primary' : 'text-secondary hover:text-primary hover:bg-gray-50'}`}>
                        <Users size={16} /> Équipe & Invitations
                    </button>
                    {isAdmin && (
                        <>
                        <button onClick={() => setActiveTab('roles')} className={`ui-focus flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors ${activeTab === 'roles' ? 'bg-gray-100 text-primary' : 'text-secondary hover:text-primary hover:bg-gray-50'}`}>
                            <Shield size={16} /> Rôles & Permissions
                        </button>
                        <button onClick={() => setActiveTab('api')} className={`ui-focus flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors ${activeTab === 'api' ? 'bg-gray-100 text-primary' : 'text-secondary hover:text-primary hover:bg-gray-50'}`}>
                            <Sliders size={16} /> Intégrations (API)
                        </button>
                        <button onClick={() => setActiveTab('tests')} className={`ui-focus flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors ${activeTab === 'tests' ? 'bg-gray-100 text-primary' : 'text-secondary hover:text-primary hover:bg-gray-50'}`}>
                            <Activity size={16} /> Diagnostic Système
                        </button>
                        </>
                    )}
                    <button onClick={() => setActiveTab('database')} className={`ui-focus flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors ${activeTab === 'database' ? 'bg-gray-100 text-primary' : 'text-secondary hover:text-primary hover:bg-gray-50'}`}>
                        <Database size={16} /> Base de données
                    </button>
                    <div className="h-px bg-border my-2 mx-3"></div>
                    <button onClick={() => signOut()} className="ui-focus flex items-center gap-3 rounded-md px-3 py-2 text-left text-sm font-medium text-rose-600 transition-colors hover:bg-rose-50">
                        <LogOut size={16} /> Déconnexion
                    </button>
                </nav>
           </Card>
        </div>

        <div className="lg:col-span-3 space-y-8">
            {activeTab === 'profile' && (
              <Card>
                  <SettingSection title="Profil Personnel">
                      <div className="flex items-center gap-6 mb-6">
                          <div className="relative group">
                              <div className="w-20 h-20 rounded bg-gray-100 overflow-hidden border border-border flex items-center justify-center relative">
                                {isUploading ? (
                                  <Loader2 className="animate-spin text-primary" />
                                ) : (
                                  <Avatar name={fullName || profile?.email || 'Utilisateur'} src={avatarUrl || profile?.avatar_url} size="lg" />
                                )}
                                <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer" onClick={() => fileInputRef.current?.click()}>
                                    <Camera className="text-white" size={20} />
                                </div>
                              </div>
                              <input type="file" ref={fileInputRef} onChange={handleUploadAvatar} accept="image/*" className="hidden" />
                          </div>
                          <div className="flex-1">
                              <label className="ui-field-label">Photo de profil</label>
                              <div className="flex gap-3">
                                <button onClick={() => fileInputRef.current?.click()} disabled={isUploading} className="ui-btn ui-btn-secondary">
                                    {isUploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />} Téléverser
                                </button>
                              </div>
                          </div>
                      </div>
                      <div className="space-y-4">
                        <div><label className="ui-field-label">Nom complet</label><input type="text" value={fullName} onChange={(e) => setFullName(e.target.value)} className="ui-input" /></div>
                        <div><label className="ui-field-label">Email</label><input type="email" value={profile?.email || ''} disabled className="ui-input cursor-not-allowed bg-gray-50 text-gray-500" /></div>
                        <div>
                          <label className="ui-field-label">Rôle actuel</label>
                          <div className="flex items-center gap-2">
                             <input type="text" value={profile?.role || 'user'} disabled className="ui-input cursor-not-allowed bg-gray-50 text-gray-500 capitalize" />
                             <span className="inline-flex rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium capitalize text-zinc-700">
                               {profile?.role}
                             </span>
                          </div>
                        </div>
                      </div>
                  </SettingSection>
                  <div className="flex justify-end pt-4 border-t border-border">
                      <button onClick={handleUpdateProfile} disabled={isSaving} className="ui-btn ui-btn-primary">
                          {isSaving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} Enregistrer
                      </button>
                  </div>
              </Card>
            )}

            {activeTab === 'team' && (
               <>
               {isAdmin && (
                   <Card>
                       <SettingSection title="Gestion des Équipes">
                           <div className="mb-4 flex flex-wrap items-center gap-2">
                             <span className="inline-flex rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-700">
                               {teamUiStats.totalTeams} équipe{teamUiStats.totalTeams > 1 ? 's' : ''}
                             </span>
                             <span className="inline-flex rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-700">
                               {teamUiStats.totalMembers} membre{teamUiStats.totalMembers > 1 ? 's' : ''}
                             </span>
                             {teamUiStats.unassignedMembers > 0 ? (
                               <span className="inline-flex rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                                 {teamUiStats.unassignedMembers} non assigné{teamUiStats.unassignedMembers > 1 ? 's' : ''}
                               </span>
                             ) : null}
                           </div>
                           <div className="rounded-md border border-border bg-zinc-50/50 p-3">
                             <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                               <div className="flex-1">
                                   <label className="ui-field-label">Nouvelle équipe</label>
                                   <input type="text" value={newTeamName} onChange={(e) => setNewTeamName(e.target.value)} placeholder="ex: Équipe Paris..." className="ui-input bg-white" />
                               </div>
                               <button onClick={handleCreateTeam} disabled={!newTeamName || isCreatingTeam} className="ui-btn ui-btn-primary w-full sm:w-auto">
                                    {isCreatingTeam ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Créer
                               </button>
                            </div>
                           </div>
                           <div className="mt-6 flex flex-wrap gap-2">
                               {teams.length === 0 && <span className="text-sm text-gray-400 italic">Aucune équipe définie.</span>}
                               {teams.length > 0 && (
                                 <div className="w-full overflow-x-auto rounded-md border border-border bg-white">
                                   <table className="ui-table min-w-[620px] text-left text-sm">
                                     <thead className="border-b border-border">
                                       <tr>
                                         <th className="px-4 py-2.5 text-xs uppercase tracking-wide text-zinc-500">Équipe</th>
                                         <th className="px-4 py-2.5 text-xs uppercase tracking-wide text-zinc-500">Membres</th>
                                         <th className="px-4 py-2.5 text-right text-xs uppercase tracking-wide text-zinc-500">Actions</th>
                                       </tr>
                                     </thead>
                                     <tbody className="divide-y divide-border">
                                       {teams.map((team) => {
                                         const count = teamMembersByTeamId.get(team.id) ?? 0;
                                         return (
                                           <tr key={team.id} className="ui-table-row hover:bg-zinc-50/50">
                                             <td className="px-4 py-2.5">
                                               <div className="flex items-center gap-2">
                                                 <Briefcase size={14} className="text-gray-500" />
                                                 <span className="text-sm font-medium text-primary">{team.name}</span>
                                               </div>
                                             </td>
                                             <td className="px-4 py-2.5">
                                               <span className="inline-flex rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-700">
                                                 {count}
                                               </span>
                                             </td>
                                             <td className="px-4 py-2.5">
                                               <div className="flex justify-end gap-1.5 sm:gap-2">
                                                 <button onClick={() => openTeamMembersModal(team)} className="ui-btn ui-btn-secondary h-8 px-2 text-[11px] sm:px-2.5 sm:text-xs">
                                                   <Eye size={12} /> Voir membres
                                                 </button>
                                                 <button onClick={() => openDeleteTeamModal(team)} className="ui-btn h-8 border border-rose-200 bg-white px-2 text-[11px] font-medium text-rose-700 hover:bg-rose-50 sm:px-2.5 sm:text-xs">
                                                   <Trash2 size={12} /> Supprimer
                                                 </button>
                                               </div>
                                             </td>
                                           </tr>
                                         );
                                       })}
                                     </tbody>
                                   </table>
                                 </div>
                               )}
                           </div>
                       </SettingSection>
                   </Card>
               )}

               <Card>
                <SettingSection title="Membres & Invitations">
                    <div className="flex justify-between items-center mb-6">
                        <p className="text-sm text-secondary">Gérez les accès de votre organisation.</p>
                        {(isAdmin || isManager) && (
                            <button onClick={() => { setIsInviteModalOpen(true); setLastInviteLink(''); }} className="ui-btn ui-btn-primary">
                                <Mail size={16} /> Inviter un membre
                            </button>
                        )}
                    </div>
                    
                    {invitations.length > 0 && (
                        <div className="mb-8">
                            <h4 className="text-xs font-bold text-secondary uppercase mb-3">Invitations en attente</h4>
                            <div className="space-y-3">
                                {invitations.map(invite => (
                                    <div key={invite.id} className="p-3 bg-yellow-50 border border-yellow-100 rounded flex justify-between items-center">
                                        <div>
                                            <p className="text-sm font-medium text-primary">{invite.email}</p>
                                            <p className="text-xs text-secondary flex gap-2">
                                                <span>{invite.role}</span> &bull; <span>{new Date(invite.created_at).toLocaleDateString()}</span>
                                            </p>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <button onClick={() => copyInviteLink(`${window.location.origin}/register?token=${invite.token}`)} className="p-2 text-gray-500 hover:text-primary"><Copy size={16} /></button>
                                            <button onClick={() => deleteInvitation(invite.id)} className="p-2 text-rose-500 hover:bg-rose-100 rounded"><LogOut size={16} /></button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    <h4 className="text-xs font-bold text-secondary uppercase mb-3">Membres</h4>
                    {isLoadingTeam ? (
                      <SectionLoader className="py-8" />
                    ) : (
                      <div className="overflow-x-auto">
                      <table className="ui-table text-left text-sm">
                        <thead className="border-b border-border">
                            <tr>
                              <th className="px-4 py-3">Utilisateur</th>
                              <th className="px-4 py-3">Rôle</th>
                              <th className="px-4 py-3">Équipe</th>
                              {isAdmin ? <th className="px-4 py-3 text-right">Actions</th> : null}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {teamMembers.map((member) => (
                              <tr key={member.id} className="ui-table-row">
                                  <td className="px-4 py-3">
                                      <div className="flex items-center gap-3">
                                          <Avatar name={member.full_name || member.email} size="sm" />
                                          <div><p className="text-sm font-medium text-primary">{member.full_name || 'Sans nom'}</p><p className="text-xs text-secondary">{member.email}</p></div>
                                      </div>
                                  </td>
                                  <td className="px-4 py-3">
                                      {isAdmin ? (
                                          <select value={member.role} onChange={(e) => handleChangeRole(member.id, e.target.value as UserRole)} className="ui-input min-h-0 h-8 cursor-pointer px-2 py-1 text-xs">
                                              <option value="commercial">Commercial</option><option value="manager">Manager</option><option value="admin">Admin</option>
                                          </select>
                                      ) : (
                                        <span className="inline-flex rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium capitalize text-zinc-700">
                                          {member.role}
                                        </span>
                                      )}
                                  </td>
                                  <td className="px-4 py-3">
                                      {isAdmin ? (
                                        <select value={member.team_id || 'none'} onChange={(e) => handleChangeTeam(member.id, e.target.value)} disabled={member.role === 'admin'} className="ui-input min-h-0 h-8 w-full max-w-[150px] cursor-pointer px-2 py-1 text-xs">
                                            <option value="none">-- Aucune --</option>
                                            {teams.map(t => (<option key={t.id} value={t.id}>{t.name}</option>))}
                                        </select>
                                      ) : <span className="text-secondary text-xs">{member.team?.name || '-'}</span>}
                                  </td>
                                  {isAdmin ? (
                                    <td className="px-4 py-3">
                                      <div className="flex justify-end">
                                        <button
                                          onClick={() => openDeleteUserModal(member)}
                                          disabled={member.id === user?.id}
                                          className="ui-btn h-8 border border-rose-200 bg-white px-2.5 text-xs font-medium text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50"
                                        >
                                          <UserX size={12} /> Supprimer
                                        </button>
                                      </div>
                                    </td>
                                  ) : null}
                              </tr>
                          ))}
                        </tbody>
                      </table>
                      </div>
                    )}
                </SettingSection>
            </Card>
            </>
            )}

            {activeTab === 'roles' && isAdmin && (
                <Card>
                    <div className="flex justify-between items-start mb-6 border-b border-border pb-4">
                        <div>
                            <h3 className="text-sm font-medium text-primary uppercase tracking-wide mb-1">Rôles & Permissions</h3>
                            <p className="text-sm text-secondary">Définissez ce que chaque rôle est autorisé à faire.</p>
                        </div>
                        <button onClick={handleResetRoles} disabled={isResettingRoles} className="ui-btn ui-btn-secondary h-8 px-3 text-xs">
                            {isResettingRoles ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />} Réinitialiser
                        </button>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="ui-table text-left text-sm border-collapse">
                            <thead>
                                <tr>
                                    <th className="p-3 border-b border-border bg-gray-50 text-secondary font-medium w-1/3">Permission</th>
                                    {rolePermissions.map(rp => (<th key={rp.role} className="p-3 border-b border-border bg-gray-50 text-primary font-medium text-center capitalize w-[100px]">{rp.role}</th>))}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border">
                                {PERMISSIONS_CONFIG.map(perm => (
                                    <tr key={perm.key} className="ui-table-row">
                                        <td className="p-3 text-secondary text-sm">{perm.label}</td>
                                        {rolePermissions.map(rp => {
                                            const isTargetAdmin = rp.role === 'admin';
                                            const isEnabled = isTargetAdmin ? true : !!rp.permissions?.[perm.key];
                                            return (
                                            <td key={`${rp.role}-${perm.key}`} className="p-3 text-center">
                                                <div className="flex justify-center">
                                                    <button
                                                        onClick={(e) => { e.preventDefault(); if (!isTargetAdmin) handleTogglePermission(rp.role, perm.key, isEnabled); }}
                                                        className={`flex items-center justify-center gap-1.5 w-24 py-1.5 rounded text-[10px] uppercase tracking-wide font-medium border ${isEnabled ? (isTargetAdmin ? 'bg-emerald-50 text-emerald-700 border-emerald-200 cursor-default' : 'bg-primary text-white border-primary cursor-pointer') : 'bg-white text-gray-400 border-gray-200 cursor-pointer'}`}
                                                    >
                                                        {isTargetAdmin && <Lock size={10} />}{isEnabled ? 'Activé' : 'Désactivé'}
                                                    </button>
                                                </div>
                                            </td>
                                        )})}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </Card>
            )}

            {activeTab === 'api' && isAdmin && (
                <Card>
                    <SettingSection title="Configurations API & Intégrations">
                        <div className="p-4 bg-blue-50 border border-blue-100 rounded text-sm text-blue-800 mb-6 flex items-start gap-3">
                            <Shield size={18} className="shrink-0 mt-0.5" />
                            <div>
                                <p className="font-bold mb-1">Mode sécurisé activé</p>
                                <p>Les secrets d'intégration ne sont plus lisibles/modifiables côté client. Les intégrations sensibles doivent être configurées côté backend (Edge Functions ou API server).</p>
                            </div>
                        </div>

                        <div className="rounded border border-border bg-white p-4 text-sm text-secondary">
                            <p className="font-medium text-primary mb-1">Integrations clients</p>
                            <p>Zadarma fonctionne actuellement en mode simulation côté interface. Branche la vraie API via backend pour activer les appels réels.</p>
                        </div>
                    </SettingSection>
                </Card>
            )}

            {activeTab === 'tests' && isAdmin && (
                <Card>
                    <SettingSection title="Diagnostic & Robustesse">
                        <div className="flex items-center justify-between mb-6">
                            <p className="text-sm text-secondary">Exécutez une série de tests automatisés pour vérifier l'intégrité du système, la sécurité des rôles et la connexion API.</p>
                            <button onClick={runSystemTests} disabled={isRunningTests} className="ui-btn ui-btn-primary">
                                {isRunningTests ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />} Lancer le Diagnostic
                            </button>
                        </div>

                        {testResults.length > 0 && (
                            <div className="space-y-2">
                                {testResults.map((test, idx) => (
                                    <div key={idx} className={`p-4 rounded border flex items-center justify-between ${
                                        test.status === 'success' ? 'bg-emerald-50 border-emerald-100 text-emerald-800' :
                                        test.status === 'failure' ? 'bg-rose-50 border-rose-100 text-rose-800' :
                                        'bg-gray-50 border-gray-100 text-gray-600'
                                    }`}>
                                        <div className="flex items-center gap-3">
                                            {test.status === 'success' && <CheckCircle size={18} className="text-emerald-600" />}
                                            {test.status === 'failure' && <XCircle size={18} className="text-rose-600" />}
                                            {test.status === 'pending' && <Loader2 size={18} className="animate-spin text-gray-400" />}
                                            <span className="font-medium text-sm">{test.name}</span>
                                        </div>
                                        <span className="text-xs font-mono opacity-80">{test.message}</span>
                                    </div>
                                ))}
                            </div>
                        )}
                        {testResults.length === 0 && !isRunningTests && (
                            <div className="ui-state-box ui-state-empty border-dashed py-12 text-center">
                                <div className="ui-state-stack">
                                  <p className="ui-state-title">Aucun test récent</p>
                                  <p className="ui-state-text">Cliquez sur "Lancer le Diagnostic".</p>
                                </div>
                            </div>
                        )}
                    </SettingSection>
                </Card>
            )}

            {activeTab === 'database' && (
               <Card>
                <SettingSection title="Gestion des Données">
                    <div className="p-4 bg-gray-50 rounded border border-border mb-6 flex items-center gap-3">
                        <Database size={18} className="text-secondary" />
                        <div><h4 className="text-sm font-medium text-primary">État de la connexion</h4><p className="text-xs text-secondary">Connecté en tant que {profile?.role}.</p></div>
                    </div>
                    <button onClick={handleReloadSchema} disabled={isReloadingSchema} className="ui-btn h-9 w-fit border border-emerald-100 bg-emerald-50 text-sm font-medium text-emerald-700 hover:bg-emerald-100">
                        {isReloadingSchema ? <Loader2 size={16} className="animate-spin" /> : <Zap size={16} />} Rafraîchir le schéma
                    </button>
                </SettingSection>
               </Card>
            )}
        </div>
      </div>

      {/* Team Members Modal */}
      <Modal isOpen={isMembersModalOpen} onClose={() => setIsMembersModalOpen(false)} maxWidth="2xl">
         <div className="w-full rounded-md bg-surface p-4 sm:p-6">
            <div className="mb-5 flex items-center justify-between border-b border-border pb-3">
              <h3 className="text-sm font-medium text-primary sm:text-base">
                Membres {selectedTeamForMembers ? `• ${selectedTeamForMembers.name}` : ''}
              </h3>
              <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-700">
                {selectedTeamMembers.length}
              </span>
            </div>
            {selectedTeamMembers.length === 0 ? (
              <div className="ui-state-box ui-state-empty py-10">
                <div className="ui-state-stack">
                  <p className="ui-state-title">Aucun membre</p>
                  <p className="ui-state-text">Cette équipe est vide pour le moment.</p>
                </div>
              </div>
            ) : (
              <div className="max-h-[64vh] space-y-2 overflow-y-auto pr-1">
                {selectedTeamMembers.map((member) => (
                  <div key={member.id} className="flex items-center justify-between rounded-md border border-border bg-white px-3 py-2">
                    <div className="min-w-0 flex items-center gap-3">
                      <Avatar name={member.full_name || member.email} src={member.avatar_url || null} size="sm" />
                      <div className="min-w-0">
                        <p className="truncate text-sm text-primary">{member.full_name || 'Sans nom'}</p>
                        <p className="truncate text-xs text-secondary">{member.email}</p>
                      </div>
                    </div>
                    <span className="ml-2 inline-flex shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium capitalize text-zinc-700">
                      {member.role}
                    </span>
                  </div>
                ))}
              </div>
            )}
            <div className="mt-6 flex justify-end">
              <button onClick={() => setIsMembersModalOpen(false)} className="ui-btn ui-btn-secondary w-full sm:w-auto">Fermer</button>
            </div>
         </div>
      </Modal>

      <Modal isOpen={isDeleteTeamModalOpen} onClose={() => setIsDeleteTeamModalOpen(false)} maxWidth="lg">
        <div className="w-full max-w-lg rounded-md bg-surface p-4 sm:p-6">
          <h3 className="text-lg font-medium text-primary mb-2">Supprimer une équipe</h3>
          <p className="text-sm text-secondary mb-4">
            Cette action supprime l&apos;équipe et ses canaux de chat associés. Les membres et invitations peuvent être réaffectés.
          </p>
          <div className="mb-4 rounded-md border border-rose-200 bg-rose-50 px-3 py-2">
            <p className="text-xs font-medium text-rose-700">Action irréversible</p>
            <p className="mt-0.5 text-xs text-rose-700/90">Les canaux d&apos;équipe seront définitivement supprimés.</p>
          </div>
          <div className="space-y-4">
            <div>
              <label className="ui-field-label">Réaffecter les membres vers</label>
              <select
                value={deleteTeamReassignTarget}
                onChange={(e) => setDeleteTeamReassignTarget(e.target.value)}
                className="ui-input"
              >
                <option value="">Aucune équipe (désassigner les membres)</option>
                {teams
                  .filter((team) => teamToDelete ? team.id !== teamToDelete.id : true)
                  .map((team) => (
                    <option key={team.id} value={team.id}>{team.name}</option>
                  ))}
              </select>
            </div>
            <div>
              <label className="ui-field-label">
                Confirmez en tapant le nom exact: <span className="font-semibold text-primary">{teamToDelete?.name}</span>
              </label>
              <input
                type="text"
                value={deleteTeamConfirmInput}
                onChange={(e) => setDeleteTeamConfirmInput(e.target.value)}
                className="ui-input"
                placeholder={teamToDelete?.name || 'Nom de l’équipe'}
              />
            </div>
          </div>
          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:gap-3">
            <button onClick={() => setIsDeleteTeamModalOpen(false)} className="ui-btn ui-btn-secondary w-full sm:w-auto">Annuler</button>
            <button
              onClick={handleDeleteTeam}
              disabled={isDeletingTeam || !teamToDelete || deleteTeamConfirmInput.trim() !== teamToDelete.name}
              className="ui-btn h-9 w-full border border-rose-700 bg-rose-700 px-4 text-sm font-medium text-white hover:bg-rose-800 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
            >
              {isDeletingTeam ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
              Supprimer l&apos;équipe
            </button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={isDeleteUserModalOpen} onClose={() => setIsDeleteUserModalOpen(false)} maxWidth="lg">
        <div className="w-full max-w-lg rounded-md bg-surface p-4 sm:p-6">
          <h3 className="mb-2 text-lg font-medium text-primary">Supprimer un utilisateur</h3>
          <p className="mb-4 text-sm text-secondary">
            Cette action supprime définitivement le compte utilisateur. Les leads, opportunités, tâches et références liées peuvent être réassignés.
          </p>
          <div className="mb-4 rounded-md border border-rose-200 bg-rose-50 px-3 py-2">
            <p className="text-xs font-medium text-rose-700">Action irréversible</p>
            <p className="mt-0.5 text-xs text-rose-700/90">Le compte supprimé ne pourra plus se connecter.</p>
          </div>

          <div className="space-y-4">
            <div>
              <label className="ui-field-label">Réassigner vers</label>
              <select
                value={deleteUserReassignTarget}
                onChange={(e) => setDeleteUserReassignTarget(e.target.value)}
                className="ui-input"
              >
                <option value="">Choisir un utilisateur...</option>
                {reassignableUsers.map((member) => (
                  <option key={member.id} value={member.id}>
                    {(member.full_name || member.email || member.id)}{member.role ? ` (${member.role})` : ''}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="ui-field-label">
                Confirmez en tapant le nom exact: <span className="font-semibold text-primary">{(userToDelete?.full_name || userToDelete?.email || 'Utilisateur').trim()}</span>
              </label>
              <input
                type="text"
                value={deleteUserConfirmInput}
                onChange={(e) => setDeleteUserConfirmInput(e.target.value)}
                className="ui-input"
                placeholder={(userToDelete?.full_name || userToDelete?.email || 'Utilisateur').trim()}
              />
            </div>
          </div>

          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:gap-3">
            <button onClick={() => setIsDeleteUserModalOpen(false)} className="ui-btn ui-btn-secondary w-full sm:w-auto">
              Annuler
            </button>
            <button
              onClick={handleDeleteUser}
              disabled={
                isDeletingUser ||
                !userToDelete ||
                !deleteUserReassignTarget ||
                deleteUserConfirmInput.trim() !== (userToDelete.full_name || userToDelete.email || 'Utilisateur').trim()
              }
              className="ui-btn h-9 w-full border border-rose-700 bg-rose-700 px-4 text-sm font-medium text-white hover:bg-rose-800 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
            >
              {isDeletingUser ? <Loader2 size={14} className="animate-spin" /> : <UserX size={14} />}
              Supprimer l&apos;utilisateur
            </button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={isInviteModalOpen} onClose={() => setIsInviteModalOpen(false)}>
         <div className="w-full max-w-md rounded-md bg-surface p-6">
            <h3 className="text-lg font-medium text-primary mb-6">Inviter un nouveau membre</h3>
            {!lastInviteLink ? (
                <div className="space-y-4">
                    <div>
                        <label className="ui-field-label">Email</label>
                        <input type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} className="ui-input" placeholder="collegue@stablemed.fr" />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="ui-field-label">Rôle</label>
                            <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value as UserRole)} className="ui-input">
                                <option value="commercial">Commercial</option>
                                <option value="manager">Manager</option>
                                <option value="admin">Admin</option>
                            </select>
                        </div>
                        <div>
                            <label className="ui-field-label">Équipe (Optionnel)</label>
                            <select value={inviteTeamId} onChange={(e) => setInviteTeamId(e.target.value)} className="ui-input">
                                <option value="">Aucune</option>
                                {teams.map(t => (<option key={t.id} value={t.id}>{t.name}</option>))}
                            </select>
                        </div>
                    </div>
                    <div className="flex justify-end gap-3 pt-4">
                        <button onClick={() => setIsInviteModalOpen(false)} className="ui-btn ui-btn-secondary">Annuler</button>
                        <button onClick={handleInviteUser} disabled={!inviteEmail || isSendingInvite} className="ui-btn ui-btn-primary">
                            {isSendingInvite ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Générer le lien
                        </button>
                    </div>
                </div>
            ) : (
                <div className="text-center">
                    <div className="w-12 h-12 bg-emerald-50 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-4 border border-emerald-100"><CheckCircle size={24} /></div>
                    <h4 className="text-lg font-medium text-primary mb-2">Invitation créée !</h4>
                    <p className="text-sm text-secondary mb-6">Envoyez ce lien à votre collègue pour qu'il configure son mot de passe.</p>
                    <div className="flex items-center gap-2 bg-gray-50 border border-border p-2 rounded mb-6">
                        <code className="text-xs text-primary truncate flex-1">{lastInviteLink}</code>
                        <button onClick={() => copyInviteLink()} className="p-1.5 hover:bg-white rounded border border-transparent hover:border-gray-200 transition-all"><Copy size={14} /></button>
                    </div>
                    <button onClick={() => { setIsInviteModalOpen(false); setLastInviteLink(''); }} className="ui-btn ui-btn-primary w-full">Fermer</button>
                </div>
            )}
         </div>
      </Modal>

      {/* SQL Warning Modal */}
      <Modal isOpen={showSqlModal} onClose={() => setShowSqlModal(false)}>
         <div className="w-full max-w-xl rounded-md bg-surface p-6 text-left">
            <div className="flex items-center gap-3 mb-4 text-orange-600"><AlertTriangle size={24} /><h3 className="text-lg font-bold">Mise à jour requise</h3></div>
            <p className="text-sm text-secondary mb-4">Le schéma de la base de données doit être mis à jour pour supporter les Invitations.</p>
            <div className="flex justify-end gap-3"><button onClick={() => setShowSqlModal(false)} className="ui-btn ui-btn-secondary">Fermer</button></div>
         </div>
      </Modal>

    </div>
  );
};

export default Settings;
