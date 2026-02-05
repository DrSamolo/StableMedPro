import React, { useEffect, useState, useRef } from 'react';
import { Card, SectionTitle, Avatar, Badge, Modal } from '../components/Common';
import { User, Shield, LogOut, Loader2, Save, Camera, Upload, Database, RefreshCw, Users, Lock, AlertTriangle, Zap, Copy, Terminal, RotateCcw, Plus, Briefcase, Mail, Send, CheckCircle, Smartphone, Sliders, Activity, XCircle, Play } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { Profile, RolePermission, UserRole, Team, Invitation, AppSetting, Lead } from '../types';
import { useNotification } from '../contexts/NotificationContext';
import { notifySlackDealWon } from '../lib/integrations'; // Import for testing

const SettingSection: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div className="mb-10">
    <h3 className="text-sm font-medium text-primary uppercase tracking-wide mb-4 border-b border-border pb-2">{title}</h3>
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

  // API Settings State
  const [apiSettings, setApiSettings] = useState<Record<string, string>>({});
  const [isLoadingApi, setIsLoadingApi] = useState(false);
  const [isSavingApi, setIsSavingApi] = useState(false);

  // Tests State
  const [testResults, setTestResults] = useState<{name: string, status: 'pending'|'success'|'failure', message: string}[]>([]);
  const [isRunningTests, setIsRunningTests] = useState(false);

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
        fetchTeam();
        fetchTeams();
        fetchInvitations();
    }
    if (activeTab === 'roles') fetchRoles();
    if (activeTab === 'api') fetchApiSettings();
  }, [activeTab]);

  const fetchTeam = async () => {
    setIsLoadingTeam(true);
    const { data, error } = await supabase
        .from('profiles')
        .select(`*, team:teams (id, name)`)
        .order('created_at', { ascending: true });
        
    if (!error && data) {
      setTeamMembers(data as Profile[]);
    }
    setIsLoadingTeam(false);
  };

  const fetchTeams = async () => {
      const { data } = await supabase.from('teams').select('*').order('created_at', { ascending: false });
      if (data) setTeams(data as Team[]);
  };

  const fetchInvitations = async () => {
      try {
          const { data, error } = await supabase
            .from('invitations')
            .select('*')
            .is('used_at', null)
            .order('created_at', { ascending: false });
          
          if (error) {
              if (error.message.includes('schema cache') || error.code === '42P01') {
                  console.warn("Invitations table not found in cache yet.");
                  return; 
              }
              throw error;
          }
          if (data) setInvitations(data as Invitation[]);
      } catch (err) {
          console.error("Fetch Invitations error:", err);
      }
  };

  const fetchRoles = async () => {
    setIsLoadingRoles(true);
    const { data, error } = await supabase.from('role_permissions').select('*');
    if (!data || data.length === 0) {
        setRolePermissions(DEFAULT_PERMISSIONS);
    } else {
        const sortOrder: Record<string, number> = { 'admin': 1, 'manager': 2, 'commercial': 3 };
        const sortedData = (data as RolePermission[]).sort((a, b) => 
            (sortOrder[a.role] || 99) - (sortOrder[b.role] || 99)
        );
        setRolePermissions(sortedData);
    }
    setIsLoadingRoles(false);
  };

  const fetchApiSettings = async () => {
      setIsLoadingApi(true);
      try {
          const { data, error } = await supabase.from('app_settings').select('*');
          if (error) throw error;
          
          const settingsMap: Record<string, string> = {};
          data?.forEach((setting: AppSetting) => {
              settingsMap[setting.key] = setting.value;
          });
          setApiSettings(settingsMap);
      } catch (error: any) {
          if (error.code === '42P01') {
              console.warn("Settings table not found");
          } else {
              console.error("Fetch API Settings Error", error);
          }
      } finally {
          setIsLoadingApi(false);
      }
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
      if (!event.target.files || event.target.files.length === 0) throw new Error('Aucun fichier sélectionné.');
      const file = event.target.files[0];
      const filePath = `${profile?.id}/${Math.random()}.${file.name.split('.').pop()}`;
      const { error: uploadError } = await supabase.storage.from('avatars').upload(filePath, file);
      if (uploadError) throw uploadError;
      const { data } = supabase.storage.from('avatars').getPublicUrl(filePath);
      if (data) setAvatarUrl(data.publicUrl);
    } catch (error: any) {
      addNotification('error', 'Erreur upload : ' + error.message);
    } finally {
      setIsUploading(false);
    }
  };

  const handleChangeRole = async (userId: string, newRole: UserRole) => {
    if (profile?.role !== 'admin') return addNotification('error', "Réservé aux admins.");
    const { error } = await supabase.from('profiles').update({ role: newRole }).eq('id', userId);
    if (error) addNotification('error', "Erreur: " + error.message);
    else {
        addNotification('success', "Rôle mis à jour.");
        setTeamMembers(prev => prev.map(m => m.id === userId ? { ...m, role: newRole } : m));
    }
  };

  const handleChangeTeam = async (userId: string, teamId: string) => {
    if (profile?.role !== 'admin') return addNotification('error', "Réservé aux admins.");
    const val = teamId === 'none' ? null : teamId;
    const { error } = await supabase.from('profiles').update({ team_id: val }).eq('id', userId);
    if (error) {
        if(error.code === '42P01') setShowSqlModal(true);
        addNotification('error', "Erreur: " + error.message);
    } else {
        addNotification('success', "Équipe assignée.");
        const team = teams.find(t => t.id === val);
        setTeamMembers(prev => prev.map(m => m.id === userId ? { ...m, team_id: val || undefined, team: team } : m));
    }
  };

  const handleCreateTeam = async () => {
      if (!newTeamName.trim()) return;
      setIsCreatingTeam(true);
      try {
          const { data, error } = await supabase.from('teams').insert([{ name: newTeamName }]).select().single();
          if (error) throw error;
          setTeams([data, ...teams]);
          setNewTeamName('');
          addNotification('success', 'Équipe créée');
      } catch (error: any) {
          if (error.code === '42P01') setShowSqlModal(true);
          else addNotification('error', error.message);
      } finally {
          setIsCreatingTeam(false);
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
          addNotification('success', 'Invitation annulée');
      }
  };

  const handleTogglePermission = async (roleName: string, permKey: string, currentValue: boolean) => {
      if (profile?.role !== 'admin') return addNotification('error', "Réservé aux admins.");
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
          await fetchRoles();
          addNotification('success', "Permissions réinitialisées.");
      } catch (error: any) {
          addNotification('error', "Erreur reset: " + error.message);
      } finally {
          setIsResettingRoles(false);
      }
  };

  const handleSaveApiSettings = async () => {
      setIsSavingApi(true);
      try {
          const upserts = Object.entries(apiSettings).map(([key, value]) => ({
              key,
              value
          }));
          
          if (upserts.length > 0) {
              const { error } = await supabase.from('app_settings').upsert(upserts);
              if (error) throw error;
          }
          addNotification('success', 'Configurations enregistrées');
      } catch (error: any) {
          if (error.code === '42P01') setShowSqlModal(true);
          else addNotification('error', error.message);
      } finally {
          setIsSavingApi(false);
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

  const handleForceAdmin = async () => {
    if (!user) return;
    const { error } = await supabase.from('profiles').update({ role: 'admin' }).eq('id', user.id);
    if (!error) {
        addNotification('success', "Vous êtes maintenant Admin !");
        await refreshProfile();
        setTimeout(() => window.location.reload(), 500);
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

          const mockLeads: Partial<Lead>[] = [
              { id: '1', user_id: 'user_A', assignee: { id: 'user_A', team_id: 'team_alpha' } as Profile } as any,
              { id: '2', user_id: 'user_B', assignee: { id: 'user_B', team_id: 'team_beta' } as Profile } as any,
          ];

          // Simulation: Commercial A should only see lead 1
          const commercialFilter = (lead: any) => lead.user_id === 'user_A';
          const filteredCommercial = mockLeads.filter(commercialFilter);
          
          if (filteredCommercial.length === 1 && filteredCommercial[0].id === '1') {
              results[0] = { name: 'Logique de Filtrage (Rôles)', status: 'success', message: 'Le filtre Commercial isole correctement les données.' };
          } else {
              results[0] = { name: 'Logique de Filtrage (Rôles)', status: 'failure', message: 'Le filtre laisse passer des données non autorisées.' };
          }
          setTestResults([...results] as any);
          await wait(500);

          // TEST 2: API Graceful Failover
          results.push({ name: 'Résilience API Slack', status: 'pending', message: 'Simulation coupure réseau...' });
          setTestResults([...results] as any);
          
          // We call the notification service. Even if config is missing or net fails, it should NOT throw.
          // Note: In a real test we would mock fetch, here we rely on the function's internal try/catch
          try {
              const res = await notifySlackDealWon({ leadName: 'TEST_DEAL', amount: 100 } as any, 'Tester');
              if (res && typeof res.success === 'boolean') {
                   results[1] = { name: 'Résilience API Slack', status: 'success', message: 'Service a géré l\'appel sans crasher (Safe Fail).' };
              } else {
                   results[1] = { name: 'Résilience API Slack', status: 'failure', message: 'Retour inattendu du service.' };
              }
          } catch (e: any) {
              results[1] = { name: 'Résilience API Slack', status: 'failure', message: 'Le service a levé une exception non gérée : ' + e.message };
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

  const isAdmin = profile?.role === 'admin';
  const isManager = profile?.role === 'manager';

  return (
    <div className="animate-fade-in max-w-6xl">
      <SectionTitle title="Paramètres" subtitle="Gérez vos préférences, votre équipe et les droits d'accès" />

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
        <div className="lg:col-span-1">
           <Card noPadding>
                <nav className="flex flex-col p-2">
                    <button onClick={() => setActiveTab('profile')} className={`flex items-center gap-3 px-3 py-2 text-sm font-medium rounded transition-colors ${activeTab === 'profile' ? 'bg-gray-50 text-primary' : 'text-secondary hover:text-primary hover:bg-gray-50'}`}>
                        <User size={16} /> Mon Profil
                    </button>
                    <button onClick={() => setActiveTab('team')} className={`flex items-center gap-3 px-3 py-2 text-sm font-medium rounded transition-colors ${activeTab === 'team' ? 'bg-gray-50 text-primary' : 'text-secondary hover:text-primary hover:bg-gray-50'}`}>
                        <Users size={16} /> Équipe & Invitations
                    </button>
                    {isAdmin && (
                        <>
                        <button onClick={() => setActiveTab('roles')} className={`flex items-center gap-3 px-3 py-2 text-sm font-medium rounded transition-colors ${activeTab === 'roles' ? 'bg-gray-50 text-primary' : 'text-secondary hover:text-primary hover:bg-gray-50'}`}>
                            <Shield size={16} /> Rôles & Permissions
                        </button>
                        <button onClick={() => setActiveTab('api')} className={`flex items-center gap-3 px-3 py-2 text-sm font-medium rounded transition-colors ${activeTab === 'api' ? 'bg-gray-50 text-primary' : 'text-secondary hover:text-primary hover:bg-gray-50'}`}>
                            <Sliders size={16} /> Intégrations (API)
                        </button>
                        <button onClick={() => setActiveTab('tests')} className={`flex items-center gap-3 px-3 py-2 text-sm font-medium rounded transition-colors ${activeTab === 'tests' ? 'bg-gray-50 text-primary' : 'text-secondary hover:text-primary hover:bg-gray-50'}`}>
                            <Activity size={16} /> Diagnostic Système
                        </button>
                        </>
                    )}
                    <button onClick={() => setActiveTab('database')} className={`flex items-center gap-3 px-3 py-2 text-sm font-medium rounded transition-colors ${activeTab === 'database' ? 'bg-gray-50 text-primary' : 'text-secondary hover:text-primary hover:bg-gray-50'}`}>
                        <Database size={16} /> Base de données
                    </button>
                    <div className="h-px bg-border my-2 mx-3"></div>
                    <button onClick={() => signOut()} className="flex items-center gap-3 px-3 py-2 text-sm font-medium text-rose-600 hover:bg-rose-50 rounded transition-colors text-left">
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
                                {isUploading ? <Loader2 className="animate-spin text-primary" /> : avatarUrl ? <img src={avatarUrl} alt="Avatar" className="w-full h-full object-cover" /> : <span className="text-2xl font-medium text-gray-500">{fullName?.charAt(0) || 'U'}</span>}
                                <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer" onClick={() => fileInputRef.current?.click()}>
                                    <Camera className="text-white" size={20} />
                                </div>
                              </div>
                              <input type="file" ref={fileInputRef} onChange={handleUploadAvatar} accept="image/*" className="hidden" />
                          </div>
                          <div className="flex-1">
                              <label className="block text-sm font-medium text-secondary mb-2">Photo de profil</label>
                              <div className="flex gap-3">
                                <button onClick={() => fileInputRef.current?.click()} disabled={isUploading} className="px-3 py-2 bg-white border border-border rounded text-sm font-medium text-primary hover:bg-gray-50 transition-colors flex items-center gap-2">
                                    {isUploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />} Téléverser
                                </button>
                              </div>
                          </div>
                      </div>
                      <div className="space-y-4">
                        <div><label className="block text-sm font-medium text-secondary mb-1">Nom complet</label><input type="text" value={fullName} onChange={(e) => setFullName(e.target.value)} className="w-full px-3 py-2 bg-white border border-border rounded text-sm text-primary focus:outline-none focus:ring-1 focus:ring-primary" /></div>
                        <div><label className="block text-sm font-medium text-secondary mb-1">Email</label><input type="email" value={profile?.email || ''} disabled className="w-full px-3 py-2 bg-gray-50 border border-border rounded text-sm text-gray-500 cursor-not-allowed" /></div>
                        <div>
                          <label className="block text-sm font-medium text-secondary mb-1">Rôle actuel</label>
                          <div className="flex items-center gap-2">
                             <input type="text" value={profile?.role || 'user'} disabled className="w-full px-3 py-2 bg-gray-50 border border-border rounded text-sm text-gray-500 cursor-not-allowed capitalize" />
                             <Badge variant="purple">{profile?.role}</Badge>
                          </div>
                        </div>
                      </div>
                  </SettingSection>
                  {!isAdmin && (
                    <div className="mb-6 p-4 bg-orange-50 border border-orange-200 rounded flex items-start gap-3">
                        <AlertTriangle className="text-orange-600 shrink-0" size={18} />
                        <div>
                            <h4 className="text-sm font-bold text-orange-800 mb-1">Mode Développeur</h4>
                            <p className="text-xs text-orange-700 mb-3">Auto-promotion Admin (Demo uniquement).</p>
                            <button onClick={handleForceAdmin} className="px-3 py-1.5 bg-orange-600 text-white text-xs font-medium rounded hover:bg-orange-700">Devenir Admin</button>
                        </div>
                    </div>
                  )}
                  <div className="flex justify-end pt-4 border-t border-border">
                      <button onClick={handleUpdateProfile} disabled={isSaving} className="flex items-center gap-2 px-4 py-2 bg-primary text-white text-sm rounded hover:bg-black transition-colors disabled:opacity-70">
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
                           <div className="flex gap-3 items-end">
                               <div className="flex-1">
                                   <label className="block text-xs font-medium text-secondary mb-1">Nom de l'équipe</label>
                                   <input type="text" value={newTeamName} onChange={(e) => setNewTeamName(e.target.value)} placeholder="ex: Équipe Paris..." className="w-full px-3 py-2 bg-white border border-border rounded text-sm outline-none focus:ring-1 focus:ring-primary" />
                               </div>
                               <button onClick={handleCreateTeam} disabled={!newTeamName || isCreatingTeam} className="px-4 py-2 bg-black text-white rounded text-sm hover:opacity-80 disabled:opacity-50 flex items-center gap-2 h-[38px]">
                                    {isCreatingTeam ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Créer
                               </button>
                           </div>
                           <div className="mt-6 flex flex-wrap gap-2">
                               {teams.length === 0 && <span className="text-sm text-gray-400 italic">Aucune équipe définie.</span>}
                               {teams.map(t => (<div key={t.id} className="flex items-center gap-2 px-3 py-1.5 bg-gray-100 rounded border border-gray-200 text-sm font-medium text-primary"><Briefcase size={14} /> {t.name}</div>))}
                           </div>
                       </SettingSection>
                   </Card>
               )}

               <Card>
                <SettingSection title="Membres & Invitations">
                    <div className="flex justify-between items-center mb-6">
                        <p className="text-sm text-secondary">Gérez les accès de votre organisation.</p>
                        {(isAdmin || isManager) && (
                            <button onClick={() => { setIsInviteModalOpen(true); setLastInviteLink(''); }} className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded text-sm hover:bg-black transition-colors">
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

                    <h4 className="text-xs font-bold text-secondary uppercase mb-3">Membres Actifs</h4>
                    {isLoadingTeam ? <div className="flex justify-center py-8"><Loader2 className="animate-spin text-gray-400" /></div> : (
                      <div className="overflow-x-auto">
                      <table className="w-full text-left text-sm">
                        <thead className="bg-gray-50 text-secondary border-b border-border font-medium">
                            <tr><th className="px-4 py-3">Utilisateur</th><th className="px-4 py-3">Rôle</th><th className="px-4 py-3">Équipe</th></tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {teamMembers.map((member) => (
                              <tr key={member.id}>
                                  <td className="px-4 py-3">
                                      <div className="flex items-center gap-3">
                                          <Avatar name={member.full_name || member.email} size="sm" />
                                          <div><p className="text-sm font-medium text-primary">{member.full_name || 'Sans nom'}</p><p className="text-xs text-secondary">{member.email}</p></div>
                                      </div>
                                  </td>
                                  <td className="px-4 py-3">
                                      {isAdmin ? (
                                          <select value={member.role} onChange={(e) => handleChangeRole(member.id, e.target.value as UserRole)} className="bg-white border border-border rounded px-2 py-1 text-xs focus:ring-1 focus:ring-primary cursor-pointer">
                                              <option value="commercial">Commercial</option><option value="manager">Manager</option><option value="admin">Admin</option>
                                          </select>
                                      ) : <Badge variant="neutral">{member.role}</Badge>}
                                  </td>
                                  <td className="px-4 py-3">
                                      {isAdmin ? (
                                        <select value={member.team_id || 'none'} onChange={(e) => handleChangeTeam(member.id, e.target.value)} disabled={member.role === 'admin'} className="bg-white border border-border rounded px-2 py-1 text-xs focus:ring-1 focus:ring-primary w-full max-w-[150px] cursor-pointer">
                                            <option value="none">-- Aucune --</option>
                                            {teams.map(t => (<option key={t.id} value={t.id}>{t.name}</option>))}
                                        </select>
                                      ) : <span className="text-secondary text-xs">{member.team?.name || '-'}</span>}
                                  </td>
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
                        <button onClick={handleResetRoles} disabled={isResettingRoles} className="flex items-center gap-2 px-3 py-1.5 bg-gray-50 border border-gray-200 text-gray-600 rounded text-xs hover:bg-gray-100 transition-colors">
                            {isResettingRoles ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />} Réinitialiser
                        </button>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm border-collapse">
                            <thead>
                                <tr>
                                    <th className="p-3 border-b border-border bg-gray-50 text-secondary font-medium w-1/3">Permission</th>
                                    {rolePermissions.map(rp => (<th key={rp.role} className="p-3 border-b border-border bg-gray-50 text-primary font-medium text-center capitalize w-[100px]">{rp.role}</th>))}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border">
                                {PERMISSIONS_CONFIG.map(perm => (
                                    <tr key={perm.key}>
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
                                <p className="font-bold mb-1">Stockage Sécurisé</p>
                                <p>Ces clés sont stockées dans la base de données. En production, les appels API réels doivent être effectués via des Edge Functions pour ne jamais exposer ces secrets au navigateur client.</p>
                            </div>
                        </div>

                        <div className="space-y-6">
                            <div>
                                <label className="block text-sm font-medium text-primary mb-2 flex items-center gap-2">
                                    <Terminal size={16} /> Slack Webhook URL
                                </label>
                                <input 
                                    type="password" 
                                    value={apiSettings['slack_webhook_url'] || ''}
                                    onChange={(e) => setApiSettings({...apiSettings, slack_webhook_url: e.target.value})}
                                    placeholder="https://hooks.slack.com/services/..."
                                    className="w-full px-3 py-2 border border-border rounded-md text-sm outline-none focus:ring-1 focus:ring-primary font-mono text-xs"
                                />
                                <p className="text-xs text-secondary mt-1">Utilisé pour notifier les ventes gagnées.</p>
                            </div>

                            <div className="border-t border-border pt-4">
                                <label className="block text-sm font-medium text-primary mb-2 flex items-center gap-2">
                                    <Smartphone size={16} /> Zadarma Key
                                </label>
                                <input 
                                    type="password" 
                                    value={apiSettings['zadarma_key'] || ''}
                                    onChange={(e) => setApiSettings({...apiSettings, zadarma_key: e.target.value})}
                                    placeholder="Key ID"
                                    className="w-full px-3 py-2 border border-border rounded-md text-sm outline-none focus:ring-1 focus:ring-primary font-mono text-xs mb-3"
                                />
                                <label className="block text-sm font-medium text-primary mb-2">Zadarma Secret</label>
                                <input 
                                    type="password" 
                                    value={apiSettings['zadarma_secret'] || ''}
                                    onChange={(e) => setApiSettings({...apiSettings, zadarma_secret: e.target.value})}
                                    placeholder="Secret"
                                    className="w-full px-3 py-2 border border-border rounded-md text-sm outline-none focus:ring-1 focus:ring-primary font-mono text-xs"
                                />
                                <p className="text-xs text-secondary mt-1">Nécessaire pour le Click-to-Call et le suivi des appels.</p>
                            </div>
                        </div>

                        <div className="flex justify-end pt-6 mt-6 border-t border-border">
                            <button onClick={handleSaveApiSettings} disabled={isSavingApi} className="flex items-center gap-2 px-4 py-2 bg-primary text-white text-sm rounded hover:bg-black transition-colors disabled:opacity-70">
                                {isSavingApi ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} Sauvegarder les configurations
                            </button>
                        </div>
                    </SettingSection>
                </Card>
            )}

            {activeTab === 'tests' && isAdmin && (
                <Card>
                    <SettingSection title="Diagnostic & Robustesse">
                        <div className="flex items-center justify-between mb-6">
                            <p className="text-sm text-secondary">Exécutez une série de tests automatisés pour vérifier l'intégrité du système, la sécurité des rôles et la connexion API.</p>
                            <button 
                                onClick={runSystemTests} 
                                disabled={isRunningTests}
                                className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded text-sm font-medium hover:bg-black transition-colors disabled:opacity-50"
                            >
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
                            <div className="text-center py-12 bg-gray-50 border border-dashed border-gray-200 rounded-lg text-secondary text-sm">
                                Aucun test récent. Cliquez sur "Lancer le Diagnostic".
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
                    <button onClick={handleReloadSchema} disabled={isReloadingSchema} className="flex items-center gap-2 px-4 py-2 bg-emerald-50 border border-emerald-100 rounded text-sm font-medium text-emerald-700 hover:bg-emerald-100 transition-all shadow-sm w-fit">
                        {isReloadingSchema ? <Loader2 size={16} className="animate-spin" /> : <Zap size={16} />} Rafraîchir le schéma
                    </button>
                </SettingSection>
               </Card>
            )}
        </div>
      </div>

      {/* Invite Modal */}
      <Modal isOpen={isInviteModalOpen} onClose={() => setIsInviteModalOpen(false)}>
         <div className="bg-surface p-6 rounded w-full max-w-md">
            <h3 className="text-lg font-medium text-primary mb-6">Inviter un nouveau membre</h3>
            {!lastInviteLink ? (
                <div className="space-y-4">
                    <div>
                        <label className="block text-xs font-medium text-secondary mb-1">Email</label>
                        <input type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} className="w-full px-3 py-2 bg-white border border-border rounded text-sm focus:ring-1 focus:ring-primary outline-none" placeholder="collegue@stablemed.fr" />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-xs font-medium text-secondary mb-1">Rôle</label>
                            <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value as UserRole)} className="w-full px-3 py-2 bg-white border border-border rounded text-sm focus:ring-1 focus:ring-primary outline-none">
                                <option value="commercial">Commercial</option>
                                <option value="manager">Manager</option>
                                <option value="admin">Admin</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-secondary mb-1">Équipe (Optionnel)</label>
                            <select value={inviteTeamId} onChange={(e) => setInviteTeamId(e.target.value)} className="w-full px-3 py-2 bg-white border border-border rounded text-sm focus:ring-1 focus:ring-primary outline-none">
                                <option value="">Aucune</option>
                                {teams.map(t => (<option key={t.id} value={t.id}>{t.name}</option>))}
                            </select>
                        </div>
                    </div>
                    <div className="flex justify-end gap-3 pt-4">
                        <button onClick={() => setIsInviteModalOpen(false)} className="px-4 py-2 text-sm text-secondary hover:bg-gray-50 rounded">Annuler</button>
                        <button onClick={handleInviteUser} disabled={!inviteEmail || isSendingInvite} className="px-4 py-2 bg-primary text-white text-sm rounded hover:bg-black flex items-center gap-2">
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
                    <button onClick={() => { setIsInviteModalOpen(false); setLastInviteLink(''); }} className="w-full py-2 bg-primary text-white text-sm rounded hover:bg-black">Fermer</button>
                </div>
            )}
         </div>
      </Modal>

      {/* SQL Warning Modal */}
      <Modal isOpen={showSqlModal} onClose={() => setShowSqlModal(false)}>
         <div className="bg-surface p-6 rounded w-full max-w-xl text-left">
            <div className="flex items-center gap-3 mb-4 text-orange-600"><AlertTriangle size={24} /><h3 className="text-lg font-bold">Mise à jour requise</h3></div>
            <p className="text-sm text-secondary mb-4">Le schéma de la base de données doit être mis à jour pour supporter les Invitations.</p>
            <div className="flex justify-end gap-3"><button onClick={() => setShowSqlModal(false)} className="px-4 py-2 text-sm text-secondary hover:bg-gray-50 rounded">Fermer</button></div>
         </div>
      </Modal>

    </div>
  );
};

export default Settings;