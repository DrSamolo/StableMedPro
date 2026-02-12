import React, { useState, useEffect, useRef } from 'react';
import { Card, Badge, SlideOver, Avatar, Modal, CustomSelect, PageHeader } from '@/components/Common';
import { FilterBar } from '@/components/FilterBar';
import { Lead, Training, Comment } from '@/types';
import { Search, Phone, Mail, Eye, Upload, Plus, Loader2, Users, Kanban, ArrowRight, MessageSquare, Send, Mic, X, Check, Lock, MapPin, Briefcase, User as UserIcon, FileText, AlertTriangle, RefreshCw, Trash2, CheckSquare, Square, Share2, Shuffle, Filter, Activity } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useNotification } from '@/contexts/NotificationContext';
import { useData } from '@/contexts/DataContext';
import { initiateZadarmaCall } from '@/lib/integrations';
import { getCached, invalidateCached, setCached } from '@/lib/perf/cache';
import { perfEnd, perfStart } from '@/lib/perf/metrics';
import { useSectionPerf } from '@/lib/perf/use-section-perf';

const LEADS_CACHE_TTL_MS = 60_000;
const TRAININGS_CACHE_TTL_MS = 3 * 60_000;
const LEADS_COMPAT_CACHE_TTL_MS = 10 * 60_000;

const Leads: React.FC = () => {
  const { user, profile } = useAuth();
  const { selectedTeamId, selectedUserId, users, teams } = useData();
  const { addNotification, pushAppNotification } = useNotification();
  
  const [leads, setLeads] = useState<Lead[]>([]);
  const [trainings, setTrainings] = useState<Training[]>([]);
  const [loading, setLoading] = useState(true);
  useSectionPerf('leads', loading);
  const [schemaError, setSchemaError] = useState(false);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  
  // Local Filters
  const [selectedProfession, setSelectedProfession] = useState<string>('all');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');

  // --- BULK ACTIONS STATE ---
  const [selectedLeadIds, setSelectedLeadIds] = useState<string[]>([]);
  const [selectCount, setSelectCount] = useState(''); // New State for Quick Select Input
  const [isBulkAssignModalOpen, setIsBulkAssignModalOpen] = useState(false);
  const [bulkAssignType, setBulkAssignType] = useState<'single' | 'team' | 'multiple'>('single');
  const [bulkTargetUser, setBulkTargetUser] = useState<string>('');
  const [bulkTargetTeam, setBulkTargetTeam] = useState<string>('');
  const [bulkTargetUsers, setBulkTargetUsers] = useState<string[]>([]); // For manual multiple select
  const [isProcessingBulk, setIsProcessingBulk] = useState(false);

  // Notes State
  const [notes, setNotes] = useState<Comment[]>([]);
  const [newNote, setNewNote] = useState('');
  const [loadingNotes, setLoadingNotes] = useState(false);
  const [submittingNote, setSubmittingNote] = useState(false);

  // Call Modal State
  const [isCallModalOpen, setIsCallModalOpen] = useState(false);
  const [callTimer, setCallTimer] = useState(0);
  const [activeCallLead, setActiveCallLead] = useState<Lead | null>(null);
  const [isInitiatingCall, setIsInitiatingCall] = useState(false);

  // Import/Create State
  const [isImporting, setIsImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  
  // New Lead State
  const [newLead, setNewLead] = useState({ 
      first_name: '', 
      last_name: '', 
      profession: '', 
      email: '', 
      phone: '', 
      address: '', 
      client_reference: '', 
      secure_info: '',
      location: '',
      user_id: '' 
  });

  // Convert to Deal State
  const [isConvertModalOpen, setIsConvertModalOpen] = useState(false);
  const [selectedTrainingIds, setSelectedTrainingIds] = useState<string[]>([]);
  const [trainingSearch, setTrainingSearch] = useState('');
  const [showTrainingDropdown, setShowTrainingDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (user) {
      fetchLeads();
      fetchTrainings();
    }
  }, [user]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowTrainingDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (selectedLead) {
        fetchNotes(selectedLead.id);
    } else {
        setNotes([]);
        setNewNote('');
    }
  }, [selectedLead]);

  useEffect(() => {
      if (isCreateModalOpen && user && !newLead.user_id) {
          setNewLead(prev => ({ ...prev, user_id: user.id }));
      }
  }, [isCreateModalOpen, user]);

  const fetchLeads = async () => {
    perfStart('leads.fetch');
    setLoading(true);
    setSchemaError(false);
    const compatKey = `leads:compat:${user?.id ?? 'anon'}`;
    const isCompatMode = getCached<boolean>(compatKey, LEADS_COMPAT_CACHE_TTL_MS) === true;
    const cacheKey = `leads:list:${user?.id ?? 'anon'}`;
    const cached = getCached<Lead[]>(cacheKey, LEADS_CACHE_TTL_MS);
    if (cached) {
      setLeads(cached);
      setLoading(false);
    }
    try {
      if (isCompatMode) {
        const { data: legacyData, error: legacyError } = await supabase
          .from('leads')
          .select('id,user_id,name,first_name,last_name,profession,client_reference,address,secure_info,email,specialty,location,status,is_pipeline,last_activity,phone')
          .order('created_at', { ascending: false });

        if (legacyError) throw legacyError;
        const mapped = mapAndSetLeads(legacyData);
        setCached(cacheKey, mapped);
        return;
      }

      const { data, error } = await supabase
        .from('leads')
        .select(`id,user_id,name,first_name,last_name,profession,client_reference,address,secure_info,email,specialty,location,status,is_pipeline,last_activity,phone, profiles:user_id ( id, full_name, avatar_url, role, team_id )`)
        .order('created_at', { ascending: false });

      if (error) throw error;
      const mapped = mapAndSetLeads(data);
      setCached(cacheKey, mapped);
      invalidateCached(compatKey);
    } catch (error: any) {
      const isSchemaMismatch =
        error?.code === '42703' ||
        String(error?.message || '').toLowerCase().includes('schema cache') ||
        String(error?.message || '').toLowerCase().includes('column');
      if (isSchemaMismatch) {
        setCached(compatKey, true);
      }
      try {
        const { data: legacyData, error: legacyError } = await supabase
            .from('leads')
            .select('id,user_id,name,first_name,last_name,profession,client_reference,address,secure_info,email,specialty,location,status,is_pipeline,last_activity,phone')
            .order('created_at', { ascending: false });
        
        if (legacyError) throw legacyError;
        const mapped = mapAndSetLeads(legacyData);
        setCached(cacheKey, mapped);
      } catch (finalError: any) {
         console.warn('Critical Leads Error', finalError?.message || finalError);
         setLeads([]);
         setSchemaError(true);
      }
    } finally {
      setLoading(false);
      perfEnd('leads.fetch');
    }
  };

  const mapAndSetLeads = (data: any[]) => {
      const mappedLeads: Lead[] = (data || []).map((l: any) => {
        let assigneeProfile = l.profiles || l.assignee;
        if (!assigneeProfile && l.user_id && users.length > 0) {
            assigneeProfile = users.find(u => u.id === l.user_id);
        }
        if (Array.isArray(assigneeProfile)) assigneeProfile = assigneeProfile[0];

        return {
            id: l.id,
            user_id: l.user_id,
            assignee: assigneeProfile, 
            name: l.name, 
            first_name: l.first_name,
            last_name: l.last_name,
            profession: l.profession,
            client_reference: l.client_reference,
            address: l.address,
            secure_info: l.secure_info,
            email: l.email || '',
            specialty: l.specialty || l.profession || 'Non renseigné',
            location: l.location || 'Inconnu',
            status: l.status as any,
            is_pipeline: l.is_pipeline || false,
            lastActivity: l.last_activity ? new Date(l.last_activity).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) : 'N/A',
            phone: l.phone,
        };
      });
      setLeads(mappedLeads);
      return mappedLeads;
  };

  const filteredLeads = leads.filter(lead => {
    const matchesSearch = !searchTerm || lead.name.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesUser = selectedUserId === 'all' || lead.user_id === selectedUserId;
    const matchesTeam = selectedTeamId === 'all' || lead.assignee?.team_id === selectedTeamId;
    const matchesProfession = selectedProfession === 'all' || (lead.profession || lead.specialty) === selectedProfession;
    const matchesStatus = selectedStatus === 'all' || lead.status === selectedStatus;
    return matchesSearch && matchesUser && matchesTeam && matchesProfession && matchesStatus;
  });

  const uniqueProfessions = Array.from(new Set(leads.map(l => l.profession || l.specialty).filter(Boolean))).sort();
  const professionOptions = [
      { value: 'all', label: 'Toutes professions' },
      ...uniqueProfessions.map(p => ({ value: p, label: p }))
  ];

  const statusOptions = [
      { value: 'all', label: 'Tous statuts' },
      { value: 'new', label: 'Nouveau' },
      { value: 'contacted', label: 'Contacté' },
      { value: 'qualified', label: 'Qualifié' },
      { value: 'closed', label: 'Fermé' },
      { value: 'lost', label: 'Perdu' }
  ];

  const handleSelectAll = () => {
      if (selectedLeadIds.length === filteredLeads.length && filteredLeads.length > 0) {
          setSelectedLeadIds([]);
      } else {
          setSelectedLeadIds(filteredLeads.map(l => l.id));
      }
  };

  const handleSelectOne = (id: string) => {
      if (selectedLeadIds.includes(id)) {
          setSelectedLeadIds(prev => prev.filter(item => item !== id));
      } else {
          setSelectedLeadIds(prev => [...prev, id]);
      }
  };

  const handleQuickSelect = () => {
      const count = parseInt(selectCount);
      if (isNaN(count) || count <= 0) return;
      
      const newSelection = filteredLeads.slice(0, count).map(l => l.id);
      setSelectedLeadIds(newSelection);
      setSelectCount('');
      addNotification('info', `${newSelection.length} leads sélectionnés`);
  };

  const toggleBulkUserSelect = (userId: string) => {
      if (bulkTargetUsers.includes(userId)) {
          setBulkTargetUsers(prev => prev.filter(id => id !== userId));
      } else {
          setBulkTargetUsers(prev => [...prev, userId]);
      }
  };

  const executeBulkAssign = async () => {
    setIsProcessingBulk(true);
    let distributionPlan: { leadId: string, userId: string }[] = [];

    try {
        let targetUserIds: string[] = [];

        if (bulkAssignType === 'single') {
            if (!bulkTargetUser) throw new Error("Veuillez sélectionner un commercial.");
            targetUserIds = [bulkTargetUser];
        } else if (bulkAssignType === 'team') {
            if (!bulkTargetTeam) throw new Error("Veuillez sélectionner une équipe.");
            targetUserIds = users.filter(u => u.team_id === bulkTargetTeam).map(u => u.id);
            if (targetUserIds.length === 0) throw new Error("Cette équipe ne contient aucun membre.");
        } else if (bulkAssignType === 'multiple') {
            if (bulkTargetUsers.length === 0) throw new Error("Veuillez sélectionner au moins un commercial.");
            targetUserIds = bulkTargetUsers;
        }

        distributionPlan = selectedLeadIds.map((leadId, index) => {
            const assigneeId = targetUserIds[index % targetUserIds.length]; 
            return { leadId, userId: assigneeId };
        });

        const promises = distributionPlan.map(({ leadId, userId }) => 
            supabase.from('leads').update({ user_id: userId }).eq('id', leadId)
        );

        await Promise.all(promises);

        // Send Notifications (Simulated broadcast)
        pushAppNotification(
            'Nouvelle Assignation',
            `Vous avez reçu de nouveaux leads (${selectedLeadIds.length}).`,
            'info'
        );

        addNotification('success', `${selectedLeadIds.length} leads réassignés avec succès.`);
        setIsBulkAssignModalOpen(false);
        setSelectedLeadIds([]);
        invalidateCached('leads:list:');
        fetchLeads(); 

    } catch (error: any) {
        addNotification('error', error.message);
    } finally {
        setIsProcessingBulk(false);
    }
  };

  const executeBulkDelete = async () => {
      if (!confirm(`Êtes-vous sûr de vouloir supprimer ${selectedLeadIds.length} leads ? Cette action est irréversible.`)) return;
      
      setIsProcessingBulk(true);
      try {
        const { error } = await supabase.from('leads').delete().in('id', selectedLeadIds);
          if (error) throw error;

          addNotification('success', 'Leads supprimés.');
          invalidateCached('leads:list:');
          setLeads(prev => prev.filter(l => !selectedLeadIds.includes(l.id)));
          setSelectedLeadIds([]);
      } catch (error: any) {
          addNotification('error', "Erreur suppression: " + error.message);
      } finally {
          setIsProcessingBulk(false);
      }
  };

  const fetchNotes = async (leadId: string) => {
    setLoadingNotes(true);
    try {
        const { data, error } = await supabase
            .from('comments')
            .select(`*, profiles:user_id ( full_name, avatar_url )`)
            .eq('lead_id', leadId)
            .order('created_at', { ascending: false });

        if (!error && data) {
            const mappedNotes: Comment[] = data.map((d: any) => ({
                id: d.id,
                lead_id: d.lead_id,
                user_id: d.user_id,
                content: d.content,
                created_at: d.created_at,
                profile: Array.isArray(d.profiles) ? d.profiles[0] : d.profiles
            }));
            setNotes(mappedNotes);
        }
    } catch (err) { console.error(err); } 
    finally { setLoadingNotes(false); }
  };

  const fetchTrainings = async () => {
    const cacheKey = `trainings:list:${user?.id ?? 'anon'}`;
    const cached = getCached<Training[]>(cacheKey, TRAININGS_CACHE_TTL_MS);
    if (cached) {
      setTrainings(cached);
      return;
    }
    const { data } = await supabase
      .from('trainings')
      .select('id,title,price')
      .order('created_at', { ascending: false })
      .limit(300);
    if (data) {
      setTrainings(data as Training[]);
      setCached(cacheKey, data as Training[]);
    }
  };

  const handleCreateLead = async () => {
    if ((!newLead.first_name && !newLead.last_name) || !user) {
        addNotification('error', "Nom et Prénom requis");
        return;
    }
    const displayName = `${newLead.first_name} ${newLead.last_name}`.trim();
    const assigneeId = newLead.user_id || user.id;

    try {
        const payload: any = {
            user_id: assigneeId,
            name: displayName,
            first_name: newLead.first_name,
            last_name: newLead.last_name,
            profession: newLead.profession,
            email: newLead.email,
            phone: newLead.phone,
            address: newLead.address,
            client_reference: newLead.client_reference,
            secure_info: newLead.secure_info,
            location: newLead.location, 
            status: 'new',
            last_activity: new Date().toISOString()
        };
        const { error } = await supabase.from('leads').insert([payload]);
        if (error) throw error;
        invalidateCached('leads:list:');
        addNotification('success', 'Contact créé avec succès');
        setIsCreateModalOpen(false);
        setNewLead({ first_name: '', last_name: '', profession: '', email: '', phone: '', address: '', client_reference: '', secure_info: '', location: '', user_id: '' });
        fetchLeads();
    } catch(err: any) {
        addNotification('error', err.message);
    }
  };

  const handleImportCSV = async (event: React.ChangeEvent<HTMLInputElement>) => {
    if (!event.target.files || !event.target.files[0] || !user) return;
    setIsImporting(true);
    const file = event.target.files[0];
    const reader = new FileReader();
    reader.onload = async (e) => {
      const text = e.target?.result as string;
      const lines = text.split('\n');
      const newLeads = [];
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        const cols = line.split(',').map(c => c.trim().replace(/^"|"$/g, ''));
        if (cols[0]) {
            newLeads.push({
                user_id: user.id,
                name: cols[0],
                first_name: cols[0].split(' ')[0],
                last_name: cols[0].split(' ').slice(1).join(' '),
                email: cols[1] || null,
                profession: cols[2] || null,
                location: cols[3] || null,
                phone: cols[4] || null,
                status: 'new'
            });
        }
      }
      if (newLeads.length > 0) {
        const { error } = await supabase.from('leads').insert(newLeads);
        if (error) addNotification('error', 'Erreur import: ' + error.message);
        else { invalidateCached('leads:list:'); addNotification('success', 'Import réussi'); fetchLeads(); }
      }
      setIsImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    };
    reader.readAsText(file);
  };

  const toggleTrainingSelection = (trainingId: string) => {
      setSelectedTrainingIds(prev => prev.includes(trainingId) ? prev.filter(id => id !== trainingId) : [...prev, trainingId]);
  };

  const handleConvertToDeal = async () => {
    if (!selectedLead || !user) return;
    const selectedTrainingObjects = trainings.filter(t => selectedTrainingIds.includes(t.id));
    const totalAmount = selectedTrainingObjects.reduce((sum, t) => sum + t.price, 0);
    const trainingTitles = selectedTrainingObjects.map(t => t.title).join(', ');
    const { data: dealData, error: dealError } = await supabase.from('deals').insert([{
        owner_id: selectedLead.user_id || user.id,
        title: selectedLead.name,
        training: trainingTitles,
        amount: totalAmount,
        stage: 'new',
        probability: 20
    }]).select().single();
    if (dealError || !dealData) return addNotification('error', "Erreur conversion: " + dealError?.message);
    if (selectedTrainingIds.length > 0) {
        const { error: relationError } = await supabase.from('deal_trainings').insert(
             selectedTrainingIds.map(tId => ({ deal_id: dealData.id, training_id: tId }))
        );
        if (relationError) {
            console.warn('Deal Trainings table missing', relationError);
        }
    }
    setIsConvertModalOpen(false);
    
    // Notify Manager/Admin
    if (profile?.role === 'commercial') {
        pushAppNotification(
            'Nouvelle Opportunité',
            `${profile.full_name} a converti ${selectedLead.name} en opportunité.`,
            'info'
        );
    }

    addNotification('success', `Opportunité créée !`);
    setSelectedLead(null);
    setSelectedTrainingIds([]);
  };

  const handleSaveNote = async () => {
    if (!selectedLead || !newNote.trim() || !user) return;
    setSubmittingNote(true);
    const { error } = await supabase.from('comments').insert([{ lead_id: selectedLead.id, user_id: user.id, content: newNote.trim() }]);
    if (error) addNotification('error', error.message);
    else { setNewNote(''); await fetchNotes(selectedLead.id); addNotification('success', "Note enregistrée."); }
    setSubmittingNote(false);
  };

  const handleStatusChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
      if (!selectedLead) return;
      const newStatus = e.target.value as Lead['status'];
      const { error } = await supabase.from('leads').update({ status: newStatus }).eq('id', selectedLead.id);
      if (!error) {
          const updated = { ...selectedLead, status: newStatus };
          setSelectedLead(updated);
          setLeads(prev => prev.map(l => l.id === selectedLead.id ? updated : l));
          addNotification('success', "Statut mis à jour.");
      }
  };

  const handleAssigneeChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
      if (!selectedLead) return;
      const newUserId = e.target.value;
      const { error } = await supabase.from('leads').update({ user_id: newUserId }).eq('id', selectedLead.id);
      if (!error) {
          const newAssignee = users.find(u => u.id === newUserId);
          const updated = { ...selectedLead, user_id: newUserId, assignee: newAssignee };
          setSelectedLead(updated);
          setLeads(prev => prev.map(l => l.id === selectedLead.id ? updated : l));
          
          // Notify the new assignee
          pushAppNotification(
              'Nouveau Lead',
              `On vous a assigné le contact : ${selectedLead.name}`,
              'info'
          );

          addNotification('success', "Responsable mis à jour.");
      } else {
          addNotification('error', "Erreur: " + error.message);
      }
  };

  const handleCall = async (lead: Lead, e: React.MouseEvent) => {
    e.stopPropagation();
    
    if (!lead.phone) {
        addNotification('warning', "Aucun numéro de téléphone pour ce contact.");
        return;
    }

    setActiveCallLead(lead);
    setIsCallModalOpen(true);
    setIsInitiatingCall(true);

    try {
        // Trigger Zadarma Integration
        // Note: '100' is a placeholder for the agent's internal SIP extension. 
        // In a real app, this should come from the user's profile settings.
        const agentSip = '100'; 
        const { success, message } = await initiateZadarmaCall(agentSip, lead.phone);
        
        if (success) {
             addNotification('success', message || "Appel initié via Zadarma.");
        } else {
             addNotification('error', message || "Échec de l'appel.");
        }

        // Update last activity
        await supabase.from('leads').update({ last_activity: new Date().toISOString() }).eq('id', lead.id);

    } catch (error) {
        console.error("Call error", error);
    } finally {
        setIsInitiatingCall(false);
    }
  };

  const handleEndCall = () => { setIsCallModalOpen(false); addNotification('info', 'Appel terminé.'); };
  const handleEmail = (lead: Lead, e: React.MouseEvent) => { e.stopPropagation(); window.location.href = `mailto:${lead.email}`; };
  
  useEffect(() => {
    let interval: any;
    if (isCallModalOpen && !isInitiatingCall) { setCallTimer(0); interval = setInterval(() => setCallTimer(p => p + 1), 1000); }
    return () => clearInterval(interval);
  }, [isCallModalOpen, isInitiatingCall]);
  
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="ui-page relative">
      <PageHeader
        title="Leads"
        subtitle="Gestion des prospects et suivi commercial"
        action={
          <div className="flex gap-2">
            <input type="file" ref={fileInputRef} accept=".csv" className="hidden" onChange={handleImportCSV} />
            <button onClick={() => fileInputRef.current?.click()} disabled={isImporting} className="ui-btn ui-btn-secondary">
                {isImporting ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />} Import CSV
            </button>
            <button onClick={() => setIsCreateModalOpen(true)} className="ui-btn ui-btn-primary">
                <Plus size={16} /> Nouveau lead
            </button>
          </div>
        }
      />
      <div className="mb-4 max-w-3xl">
        <FilterBar />
      </div>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <CustomSelect 
            value={selectedProfession}
            onChange={setSelectedProfession}
            options={professionOptions}
            icon={Briefcase}
            placeholder="Profession"
            minWidth="190px"
        />
        <CustomSelect 
            value={selectedStatus}
            onChange={setSelectedStatus}
            options={statusOptions}
            icon={Activity}
            placeholder="Statut"
            minWidth="160px"
        />
      </div>

      <Card noPadding className="min-h-[420px] overflow-hidden border-slate-200">
        <div className="flex flex-col gap-3 border-b border-border bg-slate-50/60 p-3.5 sm:flex-row sm:items-center sm:justify-between motion-fade-up">
          <div className="relative w-full md:w-80">
            <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
              <Search size={16} className="text-slate-400" />
            </div>
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Rechercher par nom..."
              className="h-10 w-full rounded-md border border-zinc-200 bg-zinc-50 px-3 pl-10 pr-4 text-sm text-zinc-900 outline-none transition focus:border-zinc-300 focus:bg-white focus-visible:shadow-[0_0_0_3px_rgba(24,24,27,0.08)]"
            />
          </div>
          <div className="flex w-full items-center gap-2 sm:w-auto">
            <span className="hidden whitespace-nowrap text-[13px] font-medium text-secondary sm:inline">Sélection rapide :</span>
            <input
              type="number"
              min="1"
              max={filteredLeads.length}
              value={selectCount}
              onChange={(e) => setSelectCount(e.target.value)}
              placeholder="Nb"
              className="ui-input w-20 text-center text-xs [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              onKeyDown={(e) => e.key === 'Enter' && handleQuickSelect()}
            />
            <button onClick={handleQuickSelect} className="ui-btn ui-btn-secondary h-9 px-3 py-0 text-xs motion-soft-hover motion-soft-press">
              Sélectionner
            </button>
          </div>
        </div>
        {loading ? (
            <div className="ui-state-box ui-state-loading m-4 flex flex-col items-center justify-center py-20 text-center">
                <Loader2 className="w-8 h-8 animate-spin mb-2" />
                <p className="ui-state-title">Chargement...</p>
                <p className="ui-state-text">Récupération des leads et des assignations.</p>
            </div>
        ) : schemaError ? (
            <div className="ui-state-box ui-state-error m-4 text-center">
                <p className="ui-state-title">Erreur de compatibilité</p>
                <p className="ui-state-text">Impossible de charger les leads avec le schéma actuel.</p>
            </div>
        ) : filteredLeads.length === 0 ? (
            <div className="ui-state-box ui-state-empty m-4 flex flex-col items-center justify-center py-20 text-center">
                <Users size={24} className="text-gray-400 mb-4" />
                <p className="ui-state-title">Aucun lead trouvé</p>
                <p className="ui-state-text">Essayez de modifier vos filtres.</p>
            </div>
        ) : (
            <div className="overflow-x-auto">
            <table className="ui-table text-left text-sm">
            <thead className="border-b border-border">
                <tr>
                <th className="w-12 px-3 py-3 text-[12px] font-semibold text-zinc-500 md:px-6">
                     <div 
                        className={`w-4 h-4 rounded-sm border flex items-center justify-center cursor-pointer transition-colors ${selectedLeadIds.length > 0 && selectedLeadIds.length === filteredLeads.length ? 'bg-zinc-800 border-zinc-800 text-white' : 'border-zinc-300 bg-white'}`}
                        onClick={handleSelectAll}
                     >
                         {selectedLeadIds.length > 0 && selectedLeadIds.length === filteredLeads.length && <Check size={10} />}
                     </div>
                </th>
                <th className="px-3 py-3 text-[12px] font-semibold text-zinc-500 md:px-6">Nom</th>
                <th className="px-3 py-3 text-[12px] font-semibold text-zinc-500 md:px-6">Profession</th>
                <th className="px-3 py-3 text-[12px] font-semibold text-zinc-500 md:px-6">Localisation</th>
                <th className="px-3 py-3 text-[12px] font-semibold text-zinc-500 md:px-6">Statut</th>
                <th className="px-3 py-3 text-[12px] font-semibold text-zinc-500 md:px-6">Responsable</th>
                <th className="px-3 py-3 text-right text-[12px] font-semibold text-zinc-500 md:px-6">Actions</th>
                </tr>
            </thead>
            <tbody className="divide-y divide-border">
                {filteredLeads.map((lead, idx) => {
                  const isSelected = selectedLeadIds.includes(lead.id);
                  return (
                    <tr 
                        key={lead.id} 
                        className={`group ui-table-row motion-fade-up ${isSelected ? 'ui-table-row-selected' : ''}`}
                        style={{ animationDelay: `${idx * 20}ms` }}
                        onClick={() => setSelectedLead(lead)}
                    >
                        <td className="px-3 py-3 md:px-6" onClick={(e) => { e.stopPropagation(); handleSelectOne(lead.id); }}>
                             <div className={`w-4 h-4 rounded-sm border flex items-center justify-center cursor-pointer transition-colors ${isSelected ? 'bg-zinc-800 border-zinc-800 text-white' : 'border-zinc-300 bg-white'}`}>
                                 {isSelected && <Check size={10} />}
                             </div>
                        </td>
                        <td className="px-3 py-3 font-medium text-primary md:px-6">
                        <div className="flex items-center gap-3">
                            <Avatar name={lead.name} size="sm" />
                            <div className="min-w-0">
                            <span className="truncate text-sm font-medium">{lead.name}</span>
                            {lead.client_reference && <span className="ml-2 rounded border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 text-[10px] text-zinc-500">{lead.client_reference}</span>}
                            <div className="mt-0.5 truncate text-[12px] text-zinc-500">{lead.email}</div>
                            </div>
                        </div>
                        </td>
                        <td className="px-3 py-3 text-secondary md:px-6">{lead.profession || lead.specialty}</td>
                        <td className="px-3 py-3 text-secondary md:px-6">{lead.location}</td>
                        <td className="px-3 py-3 md:px-6">
                        <Badge variant={lead.status === 'qualified' ? 'success' : lead.status === 'contacted' ? 'blue' : lead.status === 'closed' ? 'neutral' : lead.status === 'lost' ? 'warning' : 'neutral'}>
                            {lead.status === 'qualified' ? 'Qualifié' : lead.status === 'contacted' ? 'Contacté' : lead.status === 'closed' ? 'Fermé' : lead.status === 'lost' ? 'Perdu' : 'Nouveau'}
                        </Badge>
                        </td>
                        <td className="px-3 py-3 md:px-6">
                            {lead.assignee ? (
                                <div className="flex items-center gap-2" title={lead.assignee.full_name}>
                                    <Avatar name={lead.assignee.full_name || 'U'} src={lead.assignee.avatar_url || null} size="sm" />
                                    <span className="text-xs text-secondary truncate max-w-[80px] hidden xl:block">{lead.assignee.full_name}</span>
                                </div>
                            ) : <span className="text-xs text-gray-300">-</span>}
                        </td>
                        <td className="px-3 py-3 text-right md:px-6">
                        <div className="ui-table-action flex items-center justify-end gap-2">
                            <button onClick={(e) => handleCall(lead, e)} className="ui-focus rounded-md p-1.5 text-zinc-500 transition-colors hover:bg-emerald-50 hover:text-emerald-600"><Phone size={16} strokeWidth={1.5} /></button>
                            <button onClick={(e) => handleEmail(lead, e)} className="ui-focus rounded-md p-1.5 text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-700"><Mail size={16} strokeWidth={1.5} /></button>
                        </div>
                        </td>
                    </tr>
                )})}
            </tbody>
            </table>
            </div>
        )}
      </Card>

      {selectedLeadIds.length > 0 && (
          <div className="fixed bottom-6 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded-md border border-zinc-200 bg-white/92 px-3.5 py-2 shadow-card backdrop-blur-sm motion-scale-in">
              <span className="whitespace-nowrap text-[13px] font-semibold text-primary">{selectedLeadIds.length} sélectionné(s)</span>
              
              <div className="h-4 w-px bg-gray-200"></div>
              
              <button 
                  onClick={() => setIsBulkAssignModalOpen(true)}
                  className="ui-focus inline-flex h-8 items-center gap-2 rounded-md px-2.5 text-[13px] font-medium text-secondary transition-colors hover:bg-zinc-100 hover:text-primary motion-soft-hover motion-soft-press"
              >
                  <Share2 size={16} /> Assigner
              </button>
              
              <div className="h-4 w-px bg-gray-200"></div>

              <button 
                  onClick={executeBulkDelete}
                  className="ui-focus inline-flex h-8 items-center gap-2 rounded-md px-2.5 text-[13px] font-medium text-rose-500 transition-colors hover:bg-rose-50 hover:text-rose-600 motion-soft-hover motion-soft-press"
              >
                  <Trash2 size={16} /> Supprimer
              </button>
              
              <div className="h-4 w-px bg-gray-200"></div>

              <button 
                  onClick={() => setSelectedLeadIds([])}
                  className="ui-focus inline-flex h-8 items-center rounded-md px-2 text-gray-400 transition-colors hover:bg-zinc-100 hover:text-gray-600 motion-soft-hover motion-soft-press"
              >
                  <X size={16} />
              </button>
          </div>
      )}

      <Modal isOpen={isBulkAssignModalOpen} onClose={() => setIsBulkAssignModalOpen(false)}>
          <div className="w-full max-w-lg rounded-md bg-surface p-6">
              <div className="mb-5 border-b border-zinc-200 pb-3">
                <h3 className="text-lg font-medium text-primary">Assignation de masse</h3>
                <p className="mt-1 text-sm text-secondary">Comment souhaitez-vous répartir les {selectedLeadIds.length} leads sélectionnés ?</p>
              </div>

              <div className="mb-5 inline-flex w-full rounded-md border border-zinc-200 bg-white p-1">
                  <button 
                    onClick={() => setBulkAssignType('single')}
                    className={`ui-focus flex-1 rounded px-3 py-2 text-xs font-medium transition ${bulkAssignType === 'single' ? 'bg-zinc-900 text-white' : 'text-zinc-600 hover:bg-zinc-100'}`}
                  >
                      Individuel
                  </button>
                  <button 
                    onClick={() => setBulkAssignType('team')}
                    className={`ui-focus flex-1 rounded px-3 py-2 text-xs font-medium transition ${bulkAssignType === 'team' ? 'bg-zinc-900 text-white' : 'text-zinc-600 hover:bg-zinc-100'}`}
                  >
                      Par Équipe (Équitable)
                  </button>
                  <button 
                    onClick={() => setBulkAssignType('multiple')}
                    className={`ui-focus flex-1 rounded px-3 py-2 text-xs font-medium transition ${bulkAssignType === 'multiple' ? 'bg-zinc-900 text-white' : 'text-zinc-600 hover:bg-zinc-100'}`}
                  >
                      Multi-sélection
                  </button>
              </div>

              <div className="mb-6 space-y-4">
                  {bulkAssignType === 'single' && (
                      <div className="rounded-md border border-zinc-200 bg-zinc-50/60 p-3">
                    <label className="ui-field-label mb-2">Sélectionner un commercial</label>
                          <select 
                            value={bulkTargetUser} 
                            onChange={(e) => setBulkTargetUser(e.target.value)} 
                            className="ui-input"
                          >
                              <option value="">-- Choisir --</option>
                              {users.map(u => <option key={u.id} value={u.id}>{u.full_name || u.email}</option>)}
                          </select>
                      </div>
                  )}

                  {bulkAssignType === 'team' && (
                      <div className="rounded-md border border-zinc-200 bg-zinc-50/60 p-3">
                           <label className="ui-field-label mb-2">Sélectionner une équipe</label>
                           <select 
                             value={bulkTargetTeam} 
                             onChange={(e) => setBulkTargetTeam(e.target.value)} 
                             className="ui-input"
                           >
                               <option value="">-- Choisir --</option>
                               {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                           </select>
                           {bulkTargetTeam && (
                               <div className="mt-2 flex items-center gap-2 rounded bg-zinc-100 p-2 text-xs text-zinc-700">
                                   <Shuffle size={12} /> Distribution équitable entre les {users.filter(u => u.team_id === bulkTargetTeam).length} membres.
                               </div>
                           )}
                      </div>
                  )}

                  {bulkAssignType === 'multiple' && (
                      <div className="rounded-md border border-zinc-200 bg-zinc-50/60 p-3">
                          <label className="ui-field-label mb-2">Sélectionner les commerciaux</label>
                          <div className="max-h-40 space-y-1 overflow-y-auto rounded-md border border-zinc-200 bg-white p-2">
                              {users.map(u => (
                                  <div 
                                    key={u.id} 
                                    onClick={() => toggleBulkUserSelect(u.id)}
                                    className={`flex items-center gap-2 p-2 rounded cursor-pointer hover:bg-gray-50 text-sm ${bulkTargetUsers.includes(u.id) ? 'bg-zinc-100 text-zinc-800' : 'text-primary'}`}
                                  >
                                      <div className={`w-4 h-4 border rounded flex items-center justify-center ${bulkTargetUsers.includes(u.id) ? 'bg-zinc-700 border-zinc-700' : 'border-gray-300'}`}>
                                          {bulkTargetUsers.includes(u.id) && <Check size={10} className="text-white" />}
                                      </div>
                                      {u.full_name || u.email}
                                  </div>
                              ))}
                          </div>
                          <div className="mt-2 text-xs text-secondary">
                              Les leads seront distribués tour à tour (Round Robin) entre les {bulkTargetUsers.length} sélectionnés.
                          </div>
                      </div>
                  )}
              </div>

              <div className="flex justify-end gap-2 border-t border-zinc-200 pt-4">
                  <button onClick={() => setIsBulkAssignModalOpen(false)} className="ui-btn ui-btn-secondary">Annuler</button>
                  <button 
                    onClick={executeBulkAssign} 
                    disabled={isProcessingBulk} 
                    className="ui-btn ui-btn-primary disabled:opacity-50"
                  >
                      {isProcessingBulk ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Valider
                  </button>
              </div>
          </div>
      </Modal>

      <SlideOver isOpen={!!selectedLead} onClose={() => setSelectedLead(null)} title="Dossier Prospect">
        {selectedLead && (
          <div className="space-y-8 pb-10">
            <div className="flex items-start justify-between gap-4">
               <div className="flex items-center gap-4">
                    <Avatar name={selectedLead.name} size="lg" />
                    <div>
                        <h3 className="text-xl font-medium text-primary">{selectedLead.name}</h3>
                        <p className="text-secondary flex items-center gap-1.5 mt-0.5 text-sm"><Briefcase size={12} /> {selectedLead.profession || selectedLead.specialty}</p>
                        <p className="text-secondary flex items-center gap-1.5 mt-0.5 text-xs"><MapPin size={12} /> {selectedLead.address || selectedLead.location || 'Adresse inconnue'}</p>
                    </div>
               </div>
               <div>
                   <select value={selectedLead.status} onChange={handleStatusChange} className="block w-32 py-1.5 px-3 text-sm border border-border bg-white rounded-md focus:outline-none focus:ring-1 focus:ring-primary">
                       <option value="new">Nouveau</option>
                       <option value="contacted">Contacté</option>
                       <option value="qualified">Qualifié</option>
                       <option value="closed">Fermé</option>
                       <option value="lost">Perdu</option>
                   </select>
               </div>
            </div>

            <div className="flex gap-3">
                <button onClick={(e) => handleCall(selectedLead, e)} className="flex-1 flex items-center justify-center gap-2 py-2 border border-border rounded-md text-sm font-medium hover:bg-gray-50 transition-colors"><Phone size={14} /> Appeler</button>
                <button onClick={(e) => handleEmail(selectedLead, e)} className="flex-1 flex items-center justify-center gap-2 py-2 border border-border rounded-md text-sm font-medium hover:bg-gray-50 transition-colors"><Mail size={14} /> Email</button>
            </div>

            <div className="p-3 bg-gray-50 rounded-md border border-border flex justify-between items-center">
                <span className="text-secondary text-sm">Responsable</span>
                <select 
                    value={selectedLead.user_id || ''} 
                    onChange={handleAssigneeChange} 
                    disabled={profile?.role === 'commercial'} 
                    className="bg-transparent text-sm font-medium text-primary outline-none text-right cursor-pointer hover:underline disabled:cursor-not-allowed w-1/2"
                >
                    <option value="">Non assigné</option>
                    {users.map(u => (<option key={u.id} value={u.id}>{u.full_name || u.email}</option>))}
                </select>
            </div>

            <div className="p-4 bg-gray-900 rounded-lg text-white">
                <div className="flex items-start gap-3">
                    <div className="p-2 bg-gray-800 rounded-md"><Kanban size={18} /></div>
                    <div className="flex-1">
                        <h4 className="text-sm font-medium mb-1">Convertir en opportunité</h4>
                        <button onClick={() => { setIsConvertModalOpen(true); setSelectedTrainingIds([]); }} className="w-full mt-2 py-2 bg-white text-black text-sm font-medium rounded-md hover:bg-gray-200 transition-colors flex items-center justify-center gap-2">Créer une opportunité <ArrowRight size={14} /></button>
                    </div>
                </div>
            </div>

            <div className="space-y-4">
                <h4 className="text-sm font-medium text-primary uppercase tracking-wide">Informations Détaillées</h4>
                <div className="grid grid-cols-1 gap-4 text-sm">
                    <div className="p-3 bg-gray-50 rounded-md border border-border"><span className="text-secondary block mb-1 text-xs">Email</span><span className="text-primary font-medium">{selectedLead.email || 'N/A'}</span></div>
                    <div className="p-3 bg-gray-50 rounded-md border border-border"><span className="text-secondary block mb-1 text-xs">Téléphone</span><span className="text-primary font-medium">{selectedLead.phone || 'N/A'}</span></div>
                    {selectedLead.secure_info && <div className="p-3 bg-yellow-50 rounded-md border border-yellow-100"><span className="text-yellow-800 block mb-1 text-xs flex items-center gap-1"><Lock size={10} /> Info Sécurisée</span><span className="text-primary font-mono text-xs">{selectedLead.secure_info}</span></div>}
                </div>
            </div>
            
            <div>
                <div className="flex items-center gap-2 mb-4"><MessageSquare size={16} className="text-primary" /><h4 className="text-sm font-medium text-primary uppercase tracking-wide">Historique & Notes</h4></div>
                <div className="space-y-3 mb-4 max-h-60 overflow-y-auto pr-2">
                    {loadingNotes ? <Loader2 size={16} className="animate-spin text-gray-400 mx-auto" /> : notes.length === 0 ? <p className="text-xs text-gray-400 italic bg-gray-50 p-3 rounded border border-border">Aucune note.</p> : notes.map(note => (
                        <div key={note.id} className="bg-gray-50 p-3 rounded-md border border-border"><div className="flex justify-between items-start mb-1"><div className="flex items-center gap-2"><Avatar name={note.profile?.full_name || 'User'} size="sm" /><span className="text-xs font-medium text-primary">{note.profile?.full_name || 'Utilisateur'}</span></div><span className="text-[10px] text-gray-400">{new Date(note.created_at).toLocaleDateString()}</span></div><p className="text-sm text-secondary pl-8 whitespace-pre-line">{note.content}</p></div>
                    ))}
                </div>
                <div className="relative"><textarea className="w-full h-24 p-3 bg-white border border-border rounded-md text-sm focus:ring-1 focus:ring-primary outline-none resize-none pr-12" placeholder="Ajouter une note..." value={newNote} onChange={(e) => setNewNote(e.target.value)} disabled={submittingNote} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSaveNote(); } }}></textarea><button onClick={handleSaveNote} disabled={!newNote.trim() || submittingNote} className="absolute bottom-3 right-3 p-1.5 bg-primary text-white rounded-md hover:bg-black transition-colors disabled:opacity-50">{submittingNote ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}</button></div>
            </div>
          </div>
        )}
      </SlideOver>

      <SlideOver isOpen={isCreateModalOpen} onClose={() => setIsCreateModalOpen(false)} title="Nouveau Contact" maxWidth="2xl">
            <p className="mb-5 text-sm text-secondary">Créez un lead avec les informations essentielles.</p>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="rounded-md border border-zinc-200 bg-zinc-50/60 p-3 md:col-span-2">
                    <label className="ui-field-label">Assigné à</label>
                    <select value={newLead.user_id} onChange={(e) => setNewLead({...newLead, user_id: e.target.value})} disabled={profile?.role === 'commercial'} className="ui-input">
                        <option value="">Assigner automatiquement (Moi)</option>
                        {users.map(u => (<option key={u.id} value={u.id}>{u.full_name || u.email}</option>))}
                    </select>
                </div>
                <div><label className="ui-field-label">Prénom</label><input type="text" value={newLead.first_name} onChange={(e) => setNewLead({...newLead, first_name: e.target.value})} className="ui-input" /></div>
                <div><label className="ui-field-label">Nom</label><input type="text" value={newLead.last_name} onChange={(e) => setNewLead({...newLead, last_name: e.target.value})} className="ui-input" /></div>
                <div><label className="ui-field-label">Profession</label><input type="text" value={newLead.profession} onChange={(e) => setNewLead({...newLead, profession: e.target.value})} className="ui-input" /></div>
                <div><label className="ui-field-label">Réf. Client</label><input type="text" value={newLead.client_reference} onChange={(e) => setNewLead({...newLead, client_reference: e.target.value})} className="ui-input" /></div>
                <div><label className="ui-field-label">Email</label><input type="email" value={newLead.email} onChange={(e) => setNewLead({...newLead, email: e.target.value})} className="ui-input" /></div>
                <div><label className="ui-field-label">Téléphone</label><input type="text" value={newLead.phone} onChange={(e) => setNewLead({...newLead, phone: e.target.value})} className="ui-input" /></div>
                <div><label className="ui-field-label">Ville</label><input type="text" value={newLead.location} onChange={(e) => setNewLead({...newLead, location: e.target.value})} className="ui-input" /></div>
                <div><label className="ui-field-label">Adresse Complète</label><textarea value={newLead.address} onChange={(e) => setNewLead({...newLead, address: e.target.value})} className="ui-input h-16 resize-none" /></div>
                <div className="rounded-md border border-yellow-100 bg-yellow-50/50 p-3 md:col-span-2"><label className="mb-1 flex items-center gap-1 text-xs font-semibold uppercase tracking-[0.06em] text-yellow-800"><Lock size={10} /> Info Sécurisée</label><input type="text" value={newLead.secure_info} onChange={(e) => setNewLead({...newLead, secure_info: e.target.value})} className="ui-input border-yellow-200 bg-white" /></div>
                <div className="mt-2 flex justify-end gap-2 border-t border-zinc-200 pt-4 md:col-span-2">
                    <button onClick={() => setIsCreateModalOpen(false)} className="ui-btn ui-btn-secondary">Annuler</button>
                    <button onClick={handleCreateLead} className="ui-btn ui-btn-primary">Créer</button>
                </div>
            </div>
      </SlideOver>

      <Modal isOpen={isCallModalOpen} onClose={() => setIsCallModalOpen(false)}>
        <div className="bg-surface p-6 flex flex-col items-center">
            <div className="w-20 h-20 bg-gray-50 rounded-full flex items-center justify-center mb-4 relative">
                {isInitiatingCall ? (
                    <div className="absolute inset-0 rounded-full border-2 border-primary border-t-transparent animate-spin"></div>
                ) : (
                    <div className="absolute inset-0 rounded-full border-2 border-emerald-100 animate-ping opacity-75"></div>
                )}
                <Avatar name={activeCallLead?.name || ''} size="lg" />
            </div>
            
            <h3 className="text-lg font-medium text-primary mb-1">
                {isInitiatingCall ? 'Lancement de l\'appel...' : 'Appel en cours'}
            </h3>
            
            <p className="text-secondary text-sm mb-6">{activeCallLead?.name}</p>
            
            {!isInitiatingCall && (
                <div className="font-mono text-2xl font-light text-primary mb-8 tabular-nums">{formatTime(callTimer)}</div>
            )}

            <div className="flex gap-4 w-full">
                <button className="flex-1 py-3 rounded-full bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors flex justify-center"><Mic size={20} /></button>
                <button onClick={handleEndCall} className="flex-1 py-3 rounded-full bg-rose-500 text-white hover:bg-rose-600 transition-colors flex justify-center shadow-lg shadow-rose-200"><Phone size={20} className="rotate-[135deg]" /></button>
            </div>
        </div>
      </Modal>
    </div>
  );
};

export default Leads;
