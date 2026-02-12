import React, { useState, useEffect, useRef } from 'react';
import { Card, Badge, SectionTitle, SlideOver, Avatar, Modal, CustomSelect } from '@/components/Common';
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
    <div className="animate-fade-in relative">
      <div className="flex justify-between items-end mb-8">
        <SectionTitle title="Leads & Prospects" subtitle="Base de données qualifiée" />
        <div className="flex gap-3 mb-8">
            <input type="file" ref={fileInputRef} accept=".csv" className="hidden" onChange={handleImportCSV} />
            <button onClick={() => fileInputRef.current?.click()} disabled={isImporting} className="flex items-center gap-2 px-4 py-2 bg-white border border-border rounded-lg text-sm text-secondary hover:text-primary hover:border-gray-300 transition-colors shadow-sm">
                {isImporting ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />} Importer CSV
            </button>
            <button onClick={() => setIsCreateModalOpen(true)} className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm hover:bg-black transition-colors shadow-sm">
                <Plus size={16} /> Ajouter
            </button>
        </div>
      </div>

      <FilterBar />

      <div className="flex flex-wrap items-center gap-4 mb-6 w-fit">
          <CustomSelect 
              value={selectedProfession}
              onChange={setSelectedProfession}
              options={professionOptions}
              icon={Briefcase}
              placeholder="Profession"
              minWidth="180px"
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

      <Card noPadding className="overflow-hidden min-h-[400px]">
        <div className="border-b border-border p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-gray-50/50">
           <div className="relative group w-full md:w-80">
                <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
                    <Search size={16} className="text-gray-400 group-focus-within:text-primary transition-colors" />
                </div>
                <input 
                    type="text" 
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Rechercher par nom..." 
                    className="w-full bg-white border border-gray-200 text-primary text-sm rounded-lg py-2 pl-10 pr-4 outline-none focus:ring-2 focus:ring-gray-100 focus:border-gray-300 transition-all shadow-sm placeholder-gray-400"
                />
           </div>
           
           <div className="flex items-center gap-3 w-full sm:w-auto pt-3 sm:pt-0">
               <span className="text-xs text-secondary whitespace-nowrap hidden sm:inline">Sélection rapide :</span>
               <div className="flex items-center shadow-sm w-full sm:w-auto">
                   <input 
                        type="number" 
                        min="1"
                        max={filteredLeads.length}
                        value={selectCount}
                        onChange={(e) => setSelectCount(e.target.value)}
                        placeholder="Nb" 
                        className="w-16 px-2 py-2 text-xs border border-gray-200 rounded-l-lg outline-none focus:ring-1 focus:ring-primary focus:border-primary text-center"
                        onKeyDown={(e) => e.key === 'Enter' && handleQuickSelect()}
                   />
                   <button 
                        onClick={handleQuickSelect}
                        className="px-3 py-2 bg-white border border-l-0 border-gray-200 rounded-r-lg text-xs font-medium text-primary hover:bg-gray-50 transition-colors whitespace-nowrap flex-1 sm:flex-none"
                   >
                       Sélectionner
                   </button>
               </div>
           </div>
        </div>
        
        {loading ? (
            <div className="flex flex-col items-center justify-center py-20 text-secondary">
                <Loader2 className="w-8 h-8 animate-spin mb-2" />
                <p className="text-sm">Chargement...</p>
            </div>
        ) : filteredLeads.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-secondary">
                <Users size={24} className="text-gray-400 mb-4" />
                <h3 className="text-lg font-medium text-primary mb-1">Aucun lead trouvé</h3>
                <p className="text-xs text-gray-400">Essayez de modifier vos filtres.</p>
            </div>
        ) : (
            <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
            <thead className="bg-gray-50 text-secondary border-b border-border font-medium">
                <tr>
                <th className="px-6 py-4 font-medium w-12">
                     <div 
                        className={`w-4 h-4 rounded border flex items-center justify-center cursor-pointer transition-colors ${selectedLeadIds.length > 0 && selectedLeadIds.length === filteredLeads.length ? 'bg-primary border-primary text-white' : 'border-gray-300 bg-white'}`}
                        onClick={handleSelectAll}
                     >
                         {selectedLeadIds.length > 0 && selectedLeadIds.length === filteredLeads.length && <Check size={10} />}
                     </div>
                </th>
                <th className="px-6 py-4 font-medium">Nom</th>
                <th className="px-6 py-4 font-medium">Profession</th>
                <th className="px-6 py-4 font-medium">Localisation</th>
                <th className="px-6 py-4 font-medium">Statut</th>
                <th className="px-6 py-4 font-medium">Responsable</th>
                <th className="px-6 py-4 font-medium text-right">Actions</th>
                </tr>
            </thead>
            <tbody className="divide-y divide-border">
                {filteredLeads.map((lead, idx) => {
                  const isSelected = selectedLeadIds.includes(lead.id);
                  return (
                    <tr 
                        key={lead.id} 
                        className={`hover:bg-gray-50/50 transition-colors group cursor-pointer animate-enter ${isSelected ? 'bg-gray-50' : ''}`} 
                        style={{ animationDelay: `${idx * 50}ms` }}
                        onClick={() => setSelectedLead(lead)}
                    >
                        <td className="px-6 py-4" onClick={(e) => { e.stopPropagation(); handleSelectOne(lead.id); }}>
                             <div className={`w-4 h-4 rounded border flex items-center justify-center cursor-pointer transition-colors ${isSelected ? 'bg-primary border-primary text-white' : 'border-gray-300 bg-white'}`}>
                                 {isSelected && <Check size={10} />}
                             </div>
                        </td>
                        <td className="px-6 py-4 font-medium text-primary">
                        <div className="flex items-center gap-3">
                            <Avatar name={lead.name} size="sm" />
                            <div>
                            {lead.name}
                            {lead.client_reference && <span className="ml-2 text-[10px] bg-gray-100 px-1.5 py-0.5 rounded text-gray-500 font-mono">{lead.client_reference}</span>}
                            <div className="text-xs text-gray-400 font-light mt-0.5">{lead.email}</div>
                            </div>
                        </div>
                        </td>
                        <td className="px-6 py-4 text-secondary">{lead.profession || lead.specialty}</td>
                        <td className="px-6 py-4 text-secondary">{lead.location}</td>
                        <td className="px-6 py-4">
                        <Badge variant={lead.status === 'qualified' ? 'success' : lead.status === 'contacted' ? 'blue' : lead.status === 'closed' ? 'neutral' : lead.status === 'lost' ? 'warning' : 'neutral'}>
                            {lead.status === 'qualified' ? 'Qualifié' : lead.status === 'contacted' ? 'Contacté' : lead.status === 'closed' ? 'Fermé' : lead.status === 'lost' ? 'Perdu' : 'Nouveau'}
                        </Badge>
                        </td>
                        <td className="px-6 py-4">
                            {lead.assignee ? (
                                <div className="flex items-center gap-2" title={lead.assignee.full_name}>
                                    <Avatar name={lead.assignee.full_name || 'U'} size="sm" />
                                    <span className="text-xs text-secondary truncate max-w-[80px] hidden xl:block">{lead.assignee.full_name}</span>
                                </div>
                            ) : <span className="text-xs text-gray-300">-</span>}
                        </td>
                        <td className="px-6 py-4 text-right">
                        <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button onClick={(e) => handleCall(lead, e)} className="p-1.5 text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-md transition-colors"><Phone size={16} strokeWidth={1.5} /></button>
                            <button onClick={(e) => handleEmail(lead, e)} className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-colors"><Mail size={16} strokeWidth={1.5} /></button>
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
          <div className="fixed bottom-6 left-1/2 transform -translate-x-1/2 bg-white border border-gray-200 shadow-xl rounded-full px-6 py-3 flex items-center gap-6 z-40 animate-slide-up">
              <span className="text-sm font-medium text-primary whitespace-nowrap">{selectedLeadIds.length} sélectionné(s)</span>
              
              <div className="h-4 w-px bg-gray-200"></div>
              
              <button 
                  onClick={() => setIsBulkAssignModalOpen(true)}
                  className="flex items-center gap-2 text-sm font-medium text-secondary hover:text-primary transition-colors"
              >
                  <Share2 size={16} /> Assigner
              </button>
              
              <div className="h-4 w-px bg-gray-200"></div>

              <button 
                  onClick={executeBulkDelete}
                  className="flex items-center gap-2 text-sm font-medium text-rose-500 hover:text-rose-600 transition-colors"
              >
                  <Trash2 size={16} /> Supprimer
              </button>
              
              <div className="h-4 w-px bg-gray-200"></div>

              <button 
                  onClick={() => setSelectedLeadIds([])}
                  className="text-gray-400 hover:text-gray-600"
              >
                  <X size={16} />
              </button>
          </div>
      )}

      <Modal isOpen={isBulkAssignModalOpen} onClose={() => setIsBulkAssignModalOpen(false)}>
          <div className="bg-surface p-6 rounded-lg w-full max-w-lg">
              <h3 className="text-lg font-medium text-primary mb-4">Assignation de masse</h3>
              <p className="text-sm text-secondary mb-6">Comment souhaitez-vous répartir les {selectedLeadIds.length} leads sélectionnés ?</p>

              <div className="flex gap-2 mb-6">
                  <button 
                    onClick={() => setBulkAssignType('single')}
                    className={`flex-1 py-2 text-xs font-medium rounded border ${bulkAssignType === 'single' ? 'bg-primary text-white border-primary' : 'bg-white text-secondary border-gray-200'}`}
                  >
                      Individuel
                  </button>
                  <button 
                    onClick={() => setBulkAssignType('team')}
                    className={`flex-1 py-2 text-xs font-medium rounded border ${bulkAssignType === 'team' ? 'bg-primary text-white border-primary' : 'bg-white text-secondary border-gray-200'}`}
                  >
                      Par Équipe (Équitable)
                  </button>
                  <button 
                    onClick={() => setBulkAssignType('multiple')}
                    className={`flex-1 py-2 text-xs font-medium rounded border ${bulkAssignType === 'multiple' ? 'bg-primary text-white border-primary' : 'bg-white text-secondary border-gray-200'}`}
                  >
                      Multi-sélection
                  </button>
              </div>

              <div className="mb-6">
                  {bulkAssignType === 'single' && (
                      <div>
                          <label className="block text-xs font-medium text-secondary mb-2">Sélectionner un commercial</label>
                          <select 
                            value={bulkTargetUser} 
                            onChange={(e) => setBulkTargetUser(e.target.value)} 
                            className="w-full p-2 border border-border rounded text-sm bg-white outline-none focus:ring-1 focus:ring-primary"
                          >
                              <option value="">-- Choisir --</option>
                              {users.map(u => <option key={u.id} value={u.id}>{u.full_name || u.email}</option>)}
                          </select>
                      </div>
                  )}

                  {bulkAssignType === 'team' && (
                      <div>
                           <label className="block text-xs font-medium text-secondary mb-2">Sélectionner une équipe</label>
                           <select 
                             value={bulkTargetTeam} 
                             onChange={(e) => setBulkTargetTeam(e.target.value)} 
                             className="w-full p-2 border border-border rounded text-sm bg-white outline-none focus:ring-1 focus:ring-primary"
                           >
                               <option value="">-- Choisir --</option>
                               {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                           </select>
                           {bulkTargetTeam && (
                               <div className="mt-2 p-2 bg-blue-50 text-blue-800 text-xs rounded flex items-center gap-2">
                                   <Shuffle size={12} /> Distribution équitable entre les {users.filter(u => u.team_id === bulkTargetTeam).length} membres.
                               </div>
                           )}
                      </div>
                  )}

                  {bulkAssignType === 'multiple' && (
                      <div>
                          <label className="block text-xs font-medium text-secondary mb-2">Sélectionner les commerciaux</label>
                          <div className="border border-border rounded max-h-40 overflow-y-auto p-2 space-y-1">
                              {users.map(u => (
                                  <div 
                                    key={u.id} 
                                    onClick={() => toggleBulkUserSelect(u.id)}
                                    className={`flex items-center gap-2 p-2 rounded cursor-pointer hover:bg-gray-50 text-sm ${bulkTargetUsers.includes(u.id) ? 'bg-blue-50 text-blue-700' : 'text-primary'}`}
                                  >
                                      <div className={`w-4 h-4 border rounded flex items-center justify-center ${bulkTargetUsers.includes(u.id) ? 'bg-blue-600 border-blue-600' : 'border-gray-300'}`}>
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

              <div className="flex justify-end gap-3">
                  <button onClick={() => setIsBulkAssignModalOpen(false)} className="px-4 py-2 text-sm text-secondary hover:bg-gray-50 rounded-md">Annuler</button>
                  <button 
                    onClick={executeBulkAssign} 
                    disabled={isProcessingBulk} 
                    className="px-4 py-2 bg-primary text-white text-sm rounded-md hover:bg-black disabled:opacity-50 flex items-center gap-2"
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

      <Modal isOpen={isCreateModalOpen} onClose={() => setIsCreateModalOpen(false)}>
        <div className="bg-surface p-6 rounded-lg w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-medium text-primary mb-6">Nouveau Contact</h3>
            <div className="space-y-4">
                <div className="mb-4">
                    <label className="block text-xs font-medium text-secondary mb-1">Assigné à</label>
                    <select value={newLead.user_id} onChange={(e) => setNewLead({...newLead, user_id: e.target.value})} disabled={profile?.role === 'commercial'} className="w-full px-3 py-2 border border-border rounded-md text-sm bg-white">
                        <option value="">Assigner automatiquement (Moi)</option>
                        {users.map(u => (<option key={u.id} value={u.id}>{u.full_name || u.email}</option>))}
                    </select>
                </div>
                <div className="grid grid-cols-2 gap-4">
                     <div><label className="block text-xs font-medium text-secondary mb-1">Prénom</label><input type="text" value={newLead.first_name} onChange={(e) => setNewLead({...newLead, first_name: e.target.value})} className="w-full px-3 py-2 border border-border rounded-md text-sm" /></div>
                     <div><label className="block text-xs font-medium text-secondary mb-1">Nom</label><input type="text" value={newLead.last_name} onChange={(e) => setNewLead({...newLead, last_name: e.target.value})} className="w-full px-3 py-2 border border-border rounded-md text-sm" /></div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                     <div><label className="block text-xs font-medium text-secondary mb-1">Profession</label><input type="text" value={newLead.profession} onChange={(e) => setNewLead({...newLead, profession: e.target.value})} className="w-full px-3 py-2 border border-border rounded-md text-sm" /></div>
                     <div><label className="block text-xs font-medium text-secondary mb-1">Réf. Client</label><input type="text" value={newLead.client_reference} onChange={(e) => setNewLead({...newLead, client_reference: e.target.value})} className="w-full px-3 py-2 border border-border rounded-md text-sm" /></div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                    <div><label className="block text-xs font-medium text-secondary mb-1">Email</label><input type="email" value={newLead.email} onChange={(e) => setNewLead({...newLead, email: e.target.value})} className="w-full px-3 py-2 border border-border rounded-md text-sm" /></div>
                    <div><label className="block text-xs font-medium text-secondary mb-1">Téléphone</label><input type="text" value={newLead.phone} onChange={(e) => setNewLead({...newLead, phone: e.target.value})} className="w-full px-3 py-2 border border-border rounded-md text-sm" /></div>
                </div>
                 <div><label className="block text-xs font-medium text-secondary mb-1">Ville</label><input type="text" value={newLead.location} onChange={(e) => setNewLead({...newLead, location: e.target.value})} className="w-full px-3 py-2 border border-border rounded-md text-sm" /></div>
                <div><label className="block text-xs font-medium text-secondary mb-1">Adresse Complète</label><textarea value={newLead.address} onChange={(e) => setNewLead({...newLead, address: e.target.value})} className="w-full px-3 py-2 border border-border rounded-md text-sm h-16 resize-none" /></div>
                <div className="p-3 bg-yellow-50/50 border border-yellow-100 rounded-md"><label className="block text-xs font-bold text-yellow-800 mb-1 flex items-center gap-1"><Lock size={10} /> Info Sécurisée</label><input type="text" value={newLead.secure_info} onChange={(e) => setNewLead({...newLead, secure_info: e.target.value})} className="w-full px-3 py-2 border border-yellow-200 bg-white rounded-md text-sm" /></div>
                <div className="flex justify-end gap-3 mt-6">
                    <button onClick={() => setIsCreateModalOpen(false)} className="px-4 py-2 text-sm text-secondary hover:bg-gray-50 rounded-md">Annuler</button>
                    <button onClick={handleCreateLead} className="px-4 py-2 bg-primary text-white text-sm rounded-md hover:bg-black">Créer</button>
                </div>
            </div>
        </div>
      </Modal>

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
