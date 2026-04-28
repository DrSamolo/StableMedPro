import React, { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Card, Badge, SlideOver, Avatar, Modal, CustomSelect, PageHeader, SectionLoader } from '@/components/Common';
import { FilterBar } from '@/components/FilterBar';
import { Lead, Training, Comment } from '@/types';
import { Search, Phone, Mail, Eye, Upload, Plus, Loader2, Users, Kanban, ArrowRight, MessageSquare, Send, Mic, X, Check, Lock, MapPin, Briefcase, User as UserIcon, FileText, AlertTriangle, RefreshCw, Trash2, CheckSquare, Square, Share2, Shuffle, Filter, Activity, Save } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useNotification } from '@/contexts/NotificationContext';
import { useData } from '@/contexts/DataContext';
import { initiateZadarmaCall } from '@/lib/integrations';
import { getCached, invalidateCached, setCached } from '@/lib/perf/cache';
import { perfEnd, perfStart } from '@/lib/perf/metrics';
import { useSectionPerf } from '@/lib/perf/use-section-perf';

const TRAININGS_CACHE_TTL_MS = 3 * 60_000;
const LEADS_PAGE_SIZE = 100;
type CsvFieldKey =
  | 'ignore'
  | 'name'
  | 'first_name'
  | 'last_name'
  | 'email'
  | 'profession'
  | 'location'
  | 'phone'
  | 'address'
  | 'client_reference'
  | 'secure_info';

const CSV_FIELD_OPTIONS: Array<{ value: CsvFieldKey; label: string }> = [
  { value: 'ignore', label: 'Ignorer cette colonne' },
  { value: 'name', label: 'Nom complet' },
  { value: 'first_name', label: 'Prénom' },
  { value: 'last_name', label: 'Nom' },
  { value: 'email', label: 'Email' },
  { value: 'profession', label: 'Profession' },
  { value: 'location', label: 'Ville / Localisation' },
  { value: 'phone', label: 'Téléphone' },
  { value: 'address', label: 'Adresse' },
  { value: 'client_reference', label: 'Référence client' },
  { value: 'secure_info', label: 'Info sécurisée' },
];

const HEADER_HINTS: Record<Exclude<CsvFieldKey, 'ignore'>, string[]> = {
  name: ['name', 'nom', 'fullname', 'full_name', 'contact', 'lead'],
  first_name: ['firstname', 'first_name', 'prenom', 'prénom', 'givenname', 'given_name'],
  last_name: ['lastname', 'last_name', 'nomdefamille', 'familyname', 'family_name', 'surname'],
  email: ['email', 'mail', 'e-mail', 'courriel'],
  profession: ['profession', 'metier', 'métier', 'specialty', 'specialite', 'specialité', 'job'],
  location: ['location', 'ville', 'city', 'localisation', 'adresseville'],
  phone: ['phone', 'telephone', 'téléphone', 'mobile', 'tel', 'gsm'],
  address: ['address', 'adresse', 'street', 'rue'],
  client_reference: ['client_reference', 'referenceclient', 'reference', 'refclient', 'ref'],
  secure_info: ['secure_info', 'info_secure', 'andpc', 'password', 'motdepasse', 'mdp', 'secret'],
};

const normalizeCsvValue = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');

const parseCsvLine = (line: string, delimiter: string) => {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === delimiter && !inQuotes) {
      values.push(current.trim());
      current = '';
      continue;
    }

    current += char;
  }

  values.push(current.trim());
  return values.map((v) => v.replace(/^"|"$/g, '').trim());
};

const detectCsvDelimiter = (headerLine: string) => {
  const candidates = [',', ';', '\t'];
  const counts = candidates.map((d) => ({
    delimiter: d,
    count: (headerLine.match(new RegExp(d === '\t' ? '\\t' : `\\${d}`, 'g')) || []).length,
  }));
  counts.sort((a, b) => b.count - a.count);
  return counts[0]?.count > 0 ? counts[0].delimiter : ',';
};

type DuplicateStrategy = 'skip' | 'overwrite' | 'import_all';
type PreparedCsvRow = {
  insertPayload: any;
  updatePayload: Record<string, string>;
  duplicateType: 'existing' | 'file' | null;
  matchId: string | null;
};

type LeadWonInfoRecord = {
  id: string;
  session_label: string | null;
  first_connection_date: string | null;
  first_connection_time: string | null;
  first_connection_done: boolean;
  recording_1_url: string | null;
  recording_2_url: string | null;
  proof_url: string | null;
  sale_comment: string | null;
  followup_comment: string | null;
  organization_comment: string | null;
  unsubscription_comment: string | null;
  created_at: string;
  deals?: {
    id: string;
    title: string;
    amount: number;
  } | null;
};
type TrainingDisplayItem = {
  title: string;
  organization: string | null;
};

const Leads: React.FC = () => {
  const { user, profile, permissions } = useAuth();
  const { selectedTeamId, selectedUserId, users, teams } = useData();
  const { addNotification, pushAppNotification } = useNotification();
  const isRepresentant = (profile?.role ?? '').trim().toLowerCase() === 'representant';
  
  const [leads, setLeads] = useState<Lead[]>([]);
  const [trainings, setTrainings] = useState<Training[]>([]);
  const [loading, setLoading] = useState(true);
  useSectionPerf('leads', loading);
  const [schemaError, setSchemaError] = useState(false);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [leadDraft, setLeadDraft] = useState<Lead | null>(null);
  const [isSavingLeadDraft, setIsSavingLeadDraft] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  
  // Local Filters
  const [selectedProfession, setSelectedProfession] = useState<string>('all');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [totalFilteredLeads, setTotalFilteredLeads] = useState(0);
  const [availableProfessions, setAvailableProfessions] = useState<string[]>([]);
  const [refreshTick, setRefreshTick] = useState(0);

  // --- BULK ACTIONS STATE ---
  const [selectedLeadIds, setSelectedLeadIds] = useState<string[]>([]);
  const [selectAllFiltered, setSelectAllFiltered] = useState(false);
  const [excludedLeadIds, setExcludedLeadIds] = useState<string[]>([]);
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
  const [leadWonInfo, setLeadWonInfo] = useState<LeadWonInfoRecord | null>(null);
  const [leadWonTrainings, setLeadWonTrainings] = useState<TrainingDisplayItem[]>([]);
  const [leadTrainingsByLeadId, setLeadTrainingsByLeadId] = useState<Record<string, TrainingDisplayItem[]>>({});
  const [loadingLeadWonInfo, setLoadingLeadWonInfo] = useState(false);
  const [isLeadWonInfoModalOpen, setIsLeadWonInfoModalOpen] = useState(false);

  // Call Modal State
  const [isCallModalOpen, setIsCallModalOpen] = useState(false);
  const [callTimer, setCallTimer] = useState(0);
  const [canRenderPortal, setCanRenderPortal] = useState(false);
  const [activeCallLead, setActiveCallLead] = useState<Lead | null>(null);
  const [isInitiatingCall, setIsInitiatingCall] = useState(false);
  const refreshDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const leadsTableTopRef = useRef<HTMLDivElement | null>(null);
  const previousPageRef = useRef(currentPage);

  // Import/Create State
  const [isImporting, setIsImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isCsvMappingModalOpen, setIsCsvMappingModalOpen] = useState(false);
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvRows, setCsvRows] = useState<string[][]>([]);
  const [csvMapping, setCsvMapping] = useState<Record<string, CsvFieldKey>>({});
  const [duplicateStrategy, setDuplicateStrategy] = useState<DuplicateStrategy>('skip');
  
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

  const getDisplayedLeadTrainings = (leadId: string, isWonLead: boolean) => {
    const associatedLeadTrainings = leadTrainingsByLeadId[leadId] ?? [];
    if (associatedLeadTrainings.length > 0) return associatedLeadTrainings;
    if (isWonLead && leadWonTrainings.length > 0) return leadWonTrainings;
    return [];
  };

  useEffect(() => {
    if (user) {
      fetchTrainings();
    }
  }, [user]);

  useEffect(() => {
    if (!user) return;
    fetchProfessionOptions();
  }, [user, selectedTeamId, selectedUserId]);

  useEffect(() => {
    setCurrentPage(1);
    setSelectAllFiltered(false);
    setExcludedLeadIds([]);
    setSelectedLeadIds([]);
  }, [searchTerm, selectedProfession, selectedStatus, selectedTeamId, selectedUserId]);

  useEffect(() => {
    if (!user) return;
    fetchLeads();
  }, [user, selectedTeamId, selectedUserId, searchTerm, selectedProfession, selectedStatus, currentPage, refreshTick]);

  useEffect(() => {
    if (!user?.id) return;

    const channel = supabase
      .channel(`leads-live-${user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'leads' }, () => {
        if (refreshDebounceRef.current) clearTimeout(refreshDebounceRef.current);
        refreshDebounceRef.current = setTimeout(() => {
          setRefreshTick((v) => v + 1);
          refreshDebounceRef.current = null;
        }, 300);
      })
      .subscribe();

    return () => {
      if (refreshDebounceRef.current) {
        clearTimeout(refreshDebounceRef.current);
        refreshDebounceRef.current = null;
      }
      void supabase.removeChannel(channel);
    };
  }, [user?.id]);

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
    if (!selectedLead || selectedLead.status !== 'won') {
      setLeadWonInfo(null);
      setLeadWonTrainings([]);
      setLoadingLeadWonInfo(false);
      return;
    }

    let mounted = true;
    setLoadingLeadWonInfo(true);
    void (async () => {
      const { data, error } = await supabase
        .from('deal_win_details')
        .select(`
          id,session_label,first_connection_date,first_connection_time,first_connection_done,
          recording_1_url,recording_2_url,proof_url,sale_comment,followup_comment,organization_comment,unsubscription_comment,created_at,
          deals!inner(id,title,amount,lead_id,stage)
        `)
        .eq('deals.lead_id', selectedLead.id)
        .eq('deals.stage', 'won')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!mounted) return;
      if (error) {
        setLeadWonInfo(null);
        setLeadWonTrainings([]);
      } else {
        const row = data as any;
        const normalizedDeal = row?.deals ? (Array.isArray(row.deals) ? row.deals[0] : row.deals) : null;
        setLeadWonInfo(
          row
            ? {
                ...row,
                deals: normalizedDeal,
              }
            : null,
        );

        const dealId = normalizedDeal?.id as string | undefined;
        if (dealId) {
          const { data: trainingRows, error: trainingError } = await supabase
            .from('deal_trainings')
            .select('training:trainings(title,organization)')
            .eq('deal_id', dealId);

          if (!trainingError) {
            const unique = new Map<string, TrainingDisplayItem>();
            ((trainingRows ?? []) as Array<{ training?: { title?: string | null; organization?: string | null } | null }>).forEach((row) => {
              const title = row.training?.title?.trim() || '';
              if (!title) return;
              const organization = row.training?.organization?.trim() || null;
              unique.set(title, { title, organization });
            });
            setLeadWonTrainings(Array.from(unique.values()));
          } else {
            setLeadWonTrainings([]);
          }
        } else {
          setLeadWonTrainings([]);
        }
      }
      setLoadingLeadWonInfo(false);
    })();

    return () => {
      mounted = false;
    };
  }, [selectedLead]);

  useEffect(() => {
    setLeadDraft(selectedLead ? { ...selectedLead } : null);
  }, [selectedLead]);

  useEffect(() => {
      if (isCreateModalOpen && user && !newLead.user_id) {
          setNewLead(prev => ({ ...prev, user_id: user.id }));
      }
  }, [isCreateModalOpen, user]);

  const csvPreparedRows = useMemo<PreparedCsvRow[]>(() => {
    if (!user || csvHeaders.length === 0 || csvRows.length === 0) return [];

    const normalizeEmail = (value: string | null | undefined) => (value || '').trim().toLowerCase();
    const normalizePhone = (value: string | null | undefined) => (value || '').replace(/[^\d+]/g, '');

    const existingByEmail = new Map<string, string>();
    const existingByPhone = new Map<string, string>();
    leads.forEach((lead) => {
      const email = normalizeEmail(lead.email);
      const phone = normalizePhone(lead.phone);
      if (email && !existingByEmail.has(email)) existingByEmail.set(email, lead.id);
      if (phone && !existingByPhone.has(phone)) existingByPhone.set(phone, lead.id);
    });

    const seenCsvKeys = new Set<string>();
    return csvRows
      .map((row) => {
        const payload: Record<string, string | null> = {};

        csvHeaders.forEach((header, idx) => {
          const targetField = csvMapping[header] ?? 'ignore';
          if (targetField === 'ignore') return;
          const value = (row[idx] ?? '').trim();
          if (!value) return;
          payload[targetField] = value;
        });

        const firstName = (payload.first_name ?? '').trim();
        const lastName = (payload.last_name ?? '').trim();
        const fullNameRaw = (payload.name ?? '').trim();
        const fallbackName = [firstName, lastName].filter(Boolean).join(' ').trim();
        const finalName = fullNameRaw || fallbackName;

        if (!finalName) return null;

        const normalizedFirstName = firstName || finalName.split(' ')[0] || '';
        const normalizedLastName = lastName || finalName.split(' ').slice(1).join(' ');
        const normalizedEmail = normalizeEmail(payload.email);
        const normalizedPhone = normalizePhone(payload.phone);
        const csvKey = normalizedEmail ? `email:${normalizedEmail}` : normalizedPhone ? `phone:${normalizedPhone}` : null;

        let duplicateType: 'existing' | 'file' | null = null;
        let matchId: string | null = null;
        if (normalizedEmail && existingByEmail.has(normalizedEmail)) {
          duplicateType = 'existing';
          matchId = existingByEmail.get(normalizedEmail) ?? null;
        } else if (normalizedPhone && existingByPhone.has(normalizedPhone)) {
          duplicateType = 'existing';
          matchId = existingByPhone.get(normalizedPhone) ?? null;
        } else if (csvKey && seenCsvKeys.has(csvKey)) {
          duplicateType = 'file';
        }

        if (csvKey) seenCsvKeys.add(csvKey);

        const insertPayload = {
          user_id: user.id,
          name: finalName,
          first_name: normalizedFirstName || null,
          last_name: normalizedLastName || null,
          email: normalizedEmail || null,
          profession: (payload.profession ?? '').trim() || null,
          location: (payload.location ?? '').trim() || null,
          phone: (payload.phone ?? '').trim() || null,
          address: (payload.address ?? '').trim() || null,
          client_reference: (payload.client_reference ?? '').trim() || null,
          secure_info: (payload.secure_info ?? '').trim() || null,
          status: 'new' as const,
        };

        const updatePayload: Record<string, string> = {};
        (Object.entries(insertPayload) as Array<[string, unknown]>).forEach(([key, value]) => {
          if (key === 'user_id' || key === 'status') return;
          if (typeof value === 'string' && value.trim().length > 0) {
            updatePayload[key] = value;
          }
        });

        return { insertPayload, updatePayload, duplicateType, matchId };
      })
      .filter(Boolean) as PreparedCsvRow[];
  }, [user, csvHeaders, csvRows, csvMapping, leads]);

  const csvImportPreview = useMemo(() => {
    const existingDuplicates = csvPreparedRows.filter((row) => row.duplicateType === 'existing').length;
    const fileDuplicates = csvPreparedRows.filter((row) => row.duplicateType === 'file').length;

    let projectedInsert = 0;
    let projectedUpdate = 0;
    let projectedSkip = 0;
    csvPreparedRows.forEach((row) => {
      const isDuplicate = row.duplicateType !== null;
      if (!isDuplicate || duplicateStrategy === 'import_all') {
        projectedInsert += 1;
        return;
      }

      if (duplicateStrategy === 'skip') {
        projectedSkip += 1;
        return;
      }

      if (duplicateStrategy === 'overwrite') {
        if (row.duplicateType === 'existing' && row.matchId && Object.keys(row.updatePayload).length > 0) {
          projectedUpdate += 1;
        } else {
          projectedSkip += 1;
        }
      }
    });

    return {
      totalValidRows: csvPreparedRows.length,
      existingDuplicates,
      fileDuplicates,
      projectedInsert,
      projectedUpdate,
      projectedSkip,
    };
  }, [csvPreparedRows, duplicateStrategy]);

  const applyLeadFilters = <T,>(query: T): T => {
    let next: any = query;
    const trimmedSearch = searchTerm.trim();

    if (selectedUserId !== 'all') next = next.eq('user_id', selectedUserId);
    if (selectedStatus !== 'all') next = next.eq('status', selectedStatus);
    if (selectedProfession !== 'all') {
      next = next.or(`profession.eq.${selectedProfession},specialty.eq.${selectedProfession}`);
    }
    if (trimmedSearch) next = next.ilike('name', `%${trimmedSearch}%`);
    if (selectedTeamId !== 'all') next = next.eq('profiles.team_id', selectedTeamId);

    return next as T;
  };

  const fetchLeads = async () => {
    perfStart('leads.fetch');
    setLoading(true);
    setSchemaError(false);

    const from = (currentPage - 1) * LEADS_PAGE_SIZE;
    const to = from + LEADS_PAGE_SIZE - 1;
    const useInnerProfilesJoin = selectedTeamId !== 'all';
    const profilesSelect = useInnerProfilesJoin
      ? 'profiles:user_id!inner ( id, full_name, avatar_url, role, team_id )'
      : 'profiles:user_id ( id, full_name, avatar_url, role, team_id )';

    try {
      let countQuery: any = supabase
        .from('leads')
        .select(useInnerProfilesJoin ? 'id,profiles:user_id!inner(id)' : 'id', { count: 'exact', head: true });
      countQuery = applyLeadFilters(countQuery);

      let rowsQuery: any = supabase
        .from('leads')
        .select(
          `id,user_id,name,first_name,last_name,profession,client_reference,address,secure_info,email,specialty,location,status,is_pipeline,last_activity,phone,${profilesSelect}`,
        )
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .range(from, to);
      rowsQuery = applyLeadFilters(rowsQuery);

      const [{ count, error: countError }, { data, error: rowsError }] = await Promise.all([countQuery, rowsQuery]);
      if (countError) throw countError;
      if (rowsError) throw rowsError;

      setTotalFilteredLeads(Number(count ?? 0));
      const mapped = mapAndSetLeads((data ?? []) as any[]);
      const leadIds = mapped.map((lead) => lead.id).filter(Boolean);
      if (leadIds.length > 0) {
        const { data: trainingRows, error: leadTrainingsError } = await supabase
          .from('lead_trainings')
          .select('lead_id,training:trainings(title,organization)')
          .in('lead_id', leadIds);

        if (!leadTrainingsError) {
          const byLeadIdMap: Record<string, Map<string, TrainingDisplayItem>> = {};
          ((trainingRows ?? []) as Array<{ lead_id: string; training?: { title?: string | null; organization?: string | null } | null }>).forEach((row) => {
            const title = row.training?.title?.trim() || '';
            if (!title) return;
            const organization = row.training?.organization?.trim() || null;
            if (!byLeadIdMap[row.lead_id]) byLeadIdMap[row.lead_id] = new Map<string, TrainingDisplayItem>();
            byLeadIdMap[row.lead_id].set(title, { title, organization });
          });
          const byLeadId: Record<string, TrainingDisplayItem[]> = {};
          Object.keys(byLeadIdMap).forEach((leadId) => {
            byLeadId[leadId] = Array.from(byLeadIdMap[leadId].values());
          });
          setLeadTrainingsByLeadId(byLeadId);
        } else {
          setLeadTrainingsByLeadId({});
        }
      } else {
        setLeadTrainingsByLeadId({});
      }
    } catch (error: any) {
      console.warn('Critical Leads Error', error?.message || error);
      setLeads([]);
      setTotalFilteredLeads(0);
      setSchemaError(true);
    } finally {
      setLoading(false);
      perfEnd('leads.fetch');
    }
  };

  const fetchProfessionOptions = async () => {
    try {
      const selectedUser = selectedUserId === 'all' ? null : selectedUserId;
      const selectedTeam = selectedTeamId === 'all' ? null : selectedTeamId;

      const { data, error } = await supabase.rpc('get_lead_profession_options', {
        p_selected_user_id: selectedUser,
        p_selected_team_id: selectedTeam,
      });

      if (error) throw error;

      const values = Array.from(
        new Set(
          ((data ?? []) as Array<{ profession: string | null }>)
            .map((row) => (row?.profession || '').trim())
            .filter(Boolean),
        ),
      ).sort((a, b) => a.localeCompare(b, 'fr'));

      setAvailableProfessions(values);
    } catch (error: any) {
      console.warn('Profession options RPC error', error?.message || error);
      const fallback = Array.from(new Set(leads.map(l => l.profession || l.specialty).filter(Boolean))).sort();
      setAvailableProfessions(fallback);
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

  const pagedLeads = leads;
  const totalPages = Math.max(1, Math.ceil(totalFilteredLeads / LEADS_PAGE_SIZE));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const pageStartIndex = (safeCurrentPage - 1) * LEADS_PAGE_SIZE;
  const selectedCount = selectAllFiltered
    ? Math.max(totalFilteredLeads - excludedLeadIds.length, 0)
    : selectedLeadIds.length;

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  const professionOptions = [
      { value: 'all', label: 'Toutes professions' },
      ...availableProfessions.map(p => ({ value: p, label: p }))
  ];

  const statusOptions = [
      { value: 'all', label: 'Tous statuts' },
      { value: 'new', label: 'Nouveau' },
      { value: 'contacted', label: 'Contacté' },
      { value: 'qualified', label: 'Qualifié' },
      { value: 'won', label: 'Gagné' },
      { value: 'closed', label: 'Fermé' },
      { value: 'lost', label: 'Perdu' }
  ];

  const handleSelectAll = () => {
      const pageIds = pagedLeads.map((l) => l.id);
      const allPageSelected = pageIds.length > 0 && pageIds.every((id) =>
        selectAllFiltered ? !excludedLeadIds.includes(id) : selectedLeadIds.includes(id),
      );
      if (allPageSelected) {
          if (selectAllFiltered) {
            setExcludedLeadIds((prev) => Array.from(new Set([...prev, ...pageIds])));
          } else {
            setSelectedLeadIds((prev) => prev.filter((id) => !pageIds.includes(id)));
          }
      } else {
          if (selectAllFiltered) {
            setExcludedLeadIds((prev) => prev.filter((id) => !pageIds.includes(id)));
          } else {
            setSelectedLeadIds((prev) => Array.from(new Set([...prev, ...pageIds])));
          }
      }
  };

  const handleSelectOne = (id: string) => {
      if (selectAllFiltered) {
          if (excludedLeadIds.includes(id)) {
              setExcludedLeadIds(prev => prev.filter(item => item !== id));
          } else {
              setExcludedLeadIds(prev => [...prev, id]);
          }
          return;
      }
      if (selectedLeadIds.includes(id)) {
          setSelectedLeadIds(prev => prev.filter(item => item !== id));
      } else {
          setSelectedLeadIds(prev => [...prev, id]);
      }
  };

  const handleQuickSelect = () => {
      const count = parseInt(selectCount);
      if (isNaN(count) || count <= 0) return;
      
      setSelectAllFiltered(false);
      setExcludedLeadIds([]);
      const newSelection = pagedLeads.slice(0, count).map(l => l.id);
      setSelectedLeadIds(newSelection);
      setSelectCount('');
      addNotification('info', `${newSelection.length} leads sélectionnés`);
  };

  const clearBulkSelection = () => {
      setSelectAllFiltered(false);
      setExcludedLeadIds([]);
      setSelectedLeadIds([]);
  };

  const fetchFilteredLeadIds = async () => {
      const ids: string[] = [];
      const chunkSize = 1000;
      const useInnerProfilesJoin = selectedTeamId !== 'all';
      let offset = 0;

      while (true) {
          let idsQuery: any = supabase
              .from('leads')
              .select(useInnerProfilesJoin ? 'id,profiles:user_id!inner(id)' : 'id')
              .order('created_at', { ascending: false })
              .order('id', { ascending: false })
              .range(offset, offset + chunkSize - 1);
          idsQuery = applyLeadFilters(idsQuery);

          const { data, error } = await idsQuery;
          if (error) throw error;
          if (!data || data.length === 0) break;

          ids.push(...data.map((row: any) => row.id).filter(Boolean));
          if (data.length < chunkSize) break;
          offset += chunkSize;
      }

      return ids;
  };

  const resolveTargetLeadIds = async () => {
      if (!selectAllFiltered) return [...selectedLeadIds];
      const allFilteredIds = await fetchFilteredLeadIds();
      if (excludedLeadIds.length === 0) return allFilteredIds;
      const excludedSet = new Set(excludedLeadIds);
      return allFilteredIds.filter((id) => !excludedSet.has(id));
  };

  const toggleBulkUserSelect = (userId: string) => {
      if (bulkTargetUsers.includes(userId)) {
          setBulkTargetUsers(prev => prev.filter(id => id !== userId));
      } else {
          setBulkTargetUsers(prev => [...prev, userId]);
      }
  };

  const executeBulkAssign = async () => {
    if (isRepresentant) {
      addNotification('error', "Le rôle Représentant ne peut pas réassigner des leads.");
      return;
    }
    setIsProcessingBulk(true);
    let targetLeadIds: string[] = [];

    try {
        targetLeadIds = await resolveTargetLeadIds();
        if (targetLeadIds.length === 0) throw new Error("Aucun lead sélectionné.");
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

        const { data, error } = await supabase.rpc('bulk_reassign_leads', {
          p_lead_ids: targetLeadIds,
          p_target_user_ids: targetUserIds,
        });
        if (error) throw error;
        const updatedCount = Number(data ?? 0);

        // Send Notifications (Simulated broadcast)
        pushAppNotification(
            'Nouvelle Assignation',
            `Vous avez reçu de nouveaux leads (${targetLeadIds.length}).`,
            'info'
        );

        addNotification('success', `${updatedCount} leads réassignés avec succès.`);
        setIsBulkAssignModalOpen(false);
        setSelectedLeadIds([]);
        setSelectAllFiltered(false);
        setExcludedLeadIds([]);
        invalidateCached('leads:list:');
        await fetchLeads();
        await fetchProfessionOptions();

    } catch (error: any) {
        addNotification('error', error.message);
    } finally {
        setIsProcessingBulk(false);
    }
  };

  const executeBulkDelete = async () => {
      if (isRepresentant) {
          addNotification('error', "Le rôle Représentant ne peut pas supprimer des leads.");
          return;
      }
      const targetLeadIds = await resolveTargetLeadIds();
      if (targetLeadIds.length === 0) return;
      if (!permissions?.can_delete_leads && profile?.role !== 'admin') {
          addNotification('error', "Suppression non autorisée pour votre rôle.");
          return;
      }
      if (!confirm(`Êtes-vous sûr de vouloir supprimer ${targetLeadIds.length} leads ? Cette action est irréversible.`)) return;
      
      setIsProcessingBulk(true);
      try {
          addNotification('info', `Suppression en cours (${targetLeadIds.length} leads)...`);
          const { data, error } = await supabase.rpc('bulk_delete_leads', {
            p_lead_ids: targetLeadIds,
          });
          if (error) throw error;
          const deletedCount = Number(data ?? 0);

          if (deletedCount === 0) {
              addNotification('warning', "Aucun lead supprimé. Vérifiez les droits RLS ou les dépendances.");
              return;
          }

          addNotification('success', `${deletedCount} lead(s) supprimé(s).`);
          invalidateCached('leads:list:');
          clearBulkSelection();
          await fetchLeads();
          await fetchProfessionOptions();
      } catch (error: any) {
          const message = String(error?.message || '');
          if (error?.code === '42501' || message.toLowerCase().includes('row-level security')) {
              addNotification('error', "Suppression refusée par la politique de sécurité (RLS).");
          } else {
              addNotification('error', "Erreur suppression: " + message);
          }
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
    if (isRepresentant) {
        addNotification('error', "Le rôle Représentant ne peut pas créer de leads.");
        return;
    }
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
        await fetchLeads();
        await fetchProfessionOptions();
    } catch(err: any) {
        addNotification('error', err.message);
    }
  };

  const handleImportCSV = async (event: React.ChangeEvent<HTMLInputElement>) => {
    if (isRepresentant) {
      addNotification('error', "Le rôle Représentant ne peut pas importer de leads.");
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }
    if (!event.target.files || !event.target.files[0] || !user) return;
    const file = event.target.files[0];
    const reader = new FileReader();

    reader.onload = (e) => {
      const text = e.target?.result as string;
      const lines = text
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);

      if (lines.length < 2) {
        addNotification('warning', 'CSV vide ou incomplet.');
        if (fileInputRef.current) fileInputRef.current.value = '';
        return;
      }

      const delimiter = detectCsvDelimiter(lines[0]);
      const headers = parseCsvLine(lines[0], delimiter);
      const rows = lines
        .slice(1)
        .map((line) => parseCsvLine(line, delimiter))
        .filter((row) => row.some((cell) => cell && cell.trim().length > 0));

      if (headers.length === 0 || rows.length === 0) {
        addNotification('warning', 'Aucune donnée exploitable dans le CSV.');
        if (fileInputRef.current) fileInputRef.current.value = '';
        return;
      }

      const suggestedMapping: Record<string, CsvFieldKey> = {};
      headers.forEach((header) => {
        const normalized = normalizeCsvValue(header);
        const match = (Object.keys(HEADER_HINTS) as Array<Exclude<CsvFieldKey, 'ignore'>>).find((field) =>
          HEADER_HINTS[field].some((hint) => normalizeCsvValue(hint) === normalized),
        );
        suggestedMapping[header] = match ?? 'ignore';
      });

      setCsvHeaders(headers);
      setCsvRows(rows);
      setCsvMapping(suggestedMapping);
      setDuplicateStrategy('skip');
      setIsCsvMappingModalOpen(true);
      if (fileInputRef.current) fileInputRef.current.value = '';
    };

    reader.onerror = () => {
      addNotification('error', 'Impossible de lire le fichier CSV.');
      if (fileInputRef.current) fileInputRef.current.value = '';
    };

    reader.readAsText(file);
  };

  const handleConfirmCsvImport = async () => {
    if (isRepresentant) {
      addNotification('error', "Le rôle Représentant ne peut pas importer de leads.");
      return;
    }
    if (!user || csvHeaders.length === 0 || csvRows.length === 0) return;

    const mappedFields = Object.values(csvMapping).filter((field) => field !== 'ignore');
    if (!mappedFields.includes('name') && !(mappedFields.includes('first_name') || mappedFields.includes('last_name'))) {
      addNotification('warning', 'Mappez au moins "Nom complet" ou "Prénom/Nom".');
      return;
    }

    const preparedRows = csvPreparedRows;

    if (preparedRows.length === 0) {
      addNotification('warning', 'Aucune ligne valide à importer après mapping.');
      return;
    }

    const existingDuplicates = csvImportPreview.existingDuplicates;
    const fileDuplicates = csvImportPreview.fileDuplicates;
    if (existingDuplicates > 0 || fileDuplicates > 0) {
      addNotification(
        'info',
        `${existingDuplicates} doublon(s) CRM et ${fileDuplicates} doublon(s) dans le CSV détecté(s). Stratégie: ${
          duplicateStrategy === 'skip' ? 'Ignorer' : duplicateStrategy === 'overwrite' ? 'Écraser' : 'Importer quand même'
        }.`,
      );
    }

    setIsImporting(true);
    try {
      let inserted = 0;
      let updated = 0;
      let skipped = 0;
      let overwriteBatchCount = 0;

      const insertRows: any[] = [];
      const updateOps: Array<{ id: string; payload: Record<string, string> }> = [];
      const normalizeEmail = (value: string | null | undefined) => (value || '').trim().toLowerCase();
      const normalizePhone = (value: string | null | undefined) => (value || '').replace(/[^\d+]/g, '');

      const emailCandidates = Array.from(
        new Set(preparedRows.map((row) => normalizeEmail(row.insertPayload?.email)).filter(Boolean)),
      );
      const phoneCandidates = Array.from(
        new Set(preparedRows.map((row) => normalizePhone(row.insertPayload?.phone)).filter(Boolean)),
      );

      const existingByEmail = new Map<string, string>();
      const existingByPhone = new Map<string, string>();
      const lookupChunkSize = 500;

      for (let i = 0; i < emailCandidates.length; i += lookupChunkSize) {
        const chunk = emailCandidates.slice(i, i + lookupChunkSize);
        const { data, error } = await supabase.from('leads').select('id,email').in('email', chunk);
        if (error) throw error;
        (data ?? []).forEach((row: any) => {
          const key = normalizeEmail(row?.email);
          if (key && !existingByEmail.has(key)) existingByEmail.set(key, row.id);
        });
      }

      for (let i = 0; i < phoneCandidates.length; i += lookupChunkSize) {
        const chunk = phoneCandidates.slice(i, i + lookupChunkSize);
        const { data, error } = await supabase.from('leads').select('id,phone').in('phone', chunk);
        if (error) throw error;
        (data ?? []).forEach((row: any) => {
          const key = normalizePhone(row?.phone);
          if (key && !existingByPhone.has(key)) existingByPhone.set(key, row.id);
        });
      }

      const seenCsvKeys = new Set<string>();
      let runtimeExistingDuplicates = 0;
      let runtimeFileDuplicates = 0;

      preparedRows.forEach((row) => {
        const normalizedEmail = normalizeEmail(row.insertPayload?.email);
        const normalizedPhone = normalizePhone(row.insertPayload?.phone);
        const csvKey = normalizedEmail ? `email:${normalizedEmail}` : normalizedPhone ? `phone:${normalizedPhone}` : null;

        const existingMatchId =
          (normalizedEmail && existingByEmail.get(normalizedEmail)) ||
          (normalizedPhone && existingByPhone.get(normalizedPhone)) ||
          null;
        const isFileDuplicate = Boolean(csvKey && seenCsvKeys.has(csvKey));
        const hasDuplicate = Boolean(existingMatchId) || isFileDuplicate;

        if (existingMatchId) runtimeExistingDuplicates += 1;
        if (isFileDuplicate) runtimeFileDuplicates += 1;
        if (csvKey) seenCsvKeys.add(csvKey);

        if (!hasDuplicate || duplicateStrategy === 'import_all') {
          insertRows.push(row.insertPayload);
          return;
        }

        if (duplicateStrategy === 'skip') {
          skipped += 1;
          return;
        }

        if (duplicateStrategy === 'overwrite') {
          if (existingMatchId && Object.keys(row.updatePayload).length > 0) {
            updateOps.push({ id: existingMatchId, payload: row.updatePayload });
            return;
          }
          skipped += 1;
        }
      });

      if (runtimeExistingDuplicates > 0 || runtimeFileDuplicates > 0) {
        addNotification(
          'info',
          `${runtimeExistingDuplicates} doublon(s) CRM et ${runtimeFileDuplicates} doublon(s) dans le CSV détecté(s).`,
        );
      }

      if (insertRows.length > 0) {
        const { error: insertError } = await supabase.from('leads').insert(insertRows);
        if (insertError) {
          addNotification('error', `Erreur import: ${insertError.message}`);
          return;
        }
        inserted = insertRows.length;
      }

      if (updateOps.length > 0) {
        const chunkSize = 40;
        for (let i = 0; i < updateOps.length; i += chunkSize) {
          const chunk = updateOps.slice(i, i + chunkSize);
          overwriteBatchCount += 1;
          const updates = await Promise.all(
            chunk.map((op) => supabase.from('leads').update(op.payload).eq('id', op.id)),
          );
          const updateError = updates.find((res) => res?.error);
          if (updateError?.error) {
            addNotification('error', `Erreur mise à jour doublons: ${updateError.error.message}`);
            return;
          }
        }
        updated = updateOps.length;
      }

      if (duplicateStrategy === 'overwrite') {
        if (updated > 0) {
          addNotification('success', `Écrasement des doublons: ${updated} fiche(s) mise(s) à jour en ${overwriteBatchCount} lot(s).`);
        } else {
          addNotification(
            'warning',
            `Mode écrasement actif: aucun doublon mis à jour (${existingDuplicates} doublon(s) CRM détecté(s), ${skipped} ignoré(s)).`,
          );
        }
      }

      invalidateCached('leads:list:');
      addNotification(
        'success',
        `Import terminé: ${inserted} ajouté(s), ${updated} mis à jour, ${skipped} ignoré(s).`,
      );
      setIsCsvMappingModalOpen(false);
      setCsvHeaders([]);
      setCsvRows([]);
      setCsvMapping({});
      setDuplicateStrategy('skip');
      await fetchLeads();
      await fetchProfessionOptions();
    } finally {
      setIsImporting(false);
    }
  };

  const toggleTrainingSelection = (trainingId: string) => {
      setSelectedTrainingIds(prev => prev.includes(trainingId) ? prev.filter(id => id !== trainingId) : [...prev, trainingId]);
  };

  const handleConvertToDeal = async () => {
    if (isRepresentant) {
      addNotification('error', "Le rôle Représentant ne peut pas créer d’opportunités.");
      return;
    }
    if (!selectedLead || !user) return;
    const selectedTrainingObjects = trainings.filter(t => selectedTrainingIds.includes(t.id));
    const totalAmount = selectedTrainingObjects.reduce((sum, t) => sum + t.price, 0);
    const trainingTitles = selectedTrainingObjects.map(t => t.title).join(', ');

    let dealData: { id: string } | null = null;
    let dealError: { message?: string; code?: string } | null = null;
    const basePayload = {
      owner_id: selectedLead.user_id || user.id,
      title: selectedLead.name,
      training: trainingTitles,
      amount: totalAmount,
      stage: 'new',
      probability: 20,
    };

    const withLeadPayload: Record<string, unknown> = {
      ...basePayload,
      lead_id: selectedLead.id,
    };

    const primaryInsert = await supabase.from('deals').insert([withLeadPayload]).select('id').single();
    dealData = primaryInsert.data;
    dealError = primaryInsert.error;

    if (dealError && (dealError.code === '42703' || String(dealError.message || '').toLowerCase().includes('lead_id'))) {
      const fallbackInsert = await supabase.from('deals').insert([basePayload]).select('id').single();
      dealData = fallbackInsert.data;
      dealError = fallbackInsert.error;
    }

    if (dealError || !dealData) return addNotification('error', "Erreur conversion: " + (dealError?.message || 'inconnue'));

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
    if (profile?.role === 'commercial' || profile?.role === 'representant') {
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
      if (isRepresentant) {
        addNotification('error', "Le rôle Représentant ne peut pas modifier le statut.");
        return;
      }
      if (!selectedLead) return;
      const newStatus = e.target.value as Lead['status'];
      const isPromotedToWon = newStatus === 'won' && selectedLead.status !== 'won';

      const { error } = await supabase
        .from('leads')
        .update({ status: newStatus, last_activity: new Date().toISOString() })
        .eq('id', selectedLead.id);
      if (!error) {
          const updated = { ...selectedLead, status: newStatus };
          setSelectedLead(updated);
          setLeads(prev => prev.map(l => l.id === selectedLead.id ? updated : l));
          addNotification('success', "Statut mis à jour.");

          if (isPromotedToWon) {
            const selectedTrainingObjects = trainings.filter((t) => selectedTrainingIds.includes(t.id));
            const totalAmount = selectedTrainingObjects.reduce((sum, t) => sum + t.price, 0);
            const trainingTitles = selectedTrainingObjects.map((t) => t.title).join(', ');
            const dealPayload: Record<string, unknown> = {
              owner_id: selectedLead.user_id || user?.id,
              title: selectedLead.name,
              training: trainingTitles,
              amount: totalAmount,
              stage: 'won',
              probability: 100,
              closed_at: new Date().toISOString(),
              lead_id: selectedLead.id,
            };

            let createdDealId: string | null = null;
            const primaryInsert = await supabase.from('deals').insert([dealPayload]).select('id').single();
            let dealError = primaryInsert.error;
            if (!dealError && primaryInsert.data?.id) {
              createdDealId = primaryInsert.data.id;
            } else if (dealError && (dealError.code === '42703' || String(dealError.message || '').toLowerCase().includes('lead_id'))) {
              const fallbackPayload = { ...dealPayload };
              delete (fallbackPayload as Record<string, unknown>).lead_id;
              const fallbackInsert = await supabase.from('deals').insert([fallbackPayload]).select('id').single();
              dealError = fallbackInsert.error;
              if (!dealError && fallbackInsert.data?.id) {
                createdDealId = fallbackInsert.data.id;
              }
            }

            if (dealError || !createdDealId) {
              addNotification('warning', `Lead passé en gagné, mais opportunité non créée: ${dealError?.message || 'erreur inconnue'}`);
              return;
            }

            if (selectedTrainingIds.length > 0) {
              await supabase.from('deal_trainings').insert(
                selectedTrainingIds.map((trainingId) => ({ deal_id: createdDealId, training_id: trainingId })),
              );
            }

            addNotification('success', 'Opportunité gagnée créée. Ouverture de la prise d’informations vente...');
            window.location.assign(`/dashboard/pipeline?action=capture-sale&dealId=${createdDealId}&leadId=${selectedLead.id}`);
          }
      }
  };

  const handleAssigneeChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
      if (isRepresentant) {
        addNotification('error', "Le rôle Représentant ne peut pas réassigner un lead.");
        return;
      }
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

  const updateLeadDraft = (field: keyof Lead, value: string) => {
    setLeadDraft((prev) => (prev ? { ...prev, [field]: value } : prev));
  };

  const saveLeadDraft = async () => {
    if (isRepresentant) {
      addNotification('error', "Le rôle Représentant ne peut pas modifier les informations du lead.");
      return;
    }
    if (!selectedLead || !leadDraft) return;
    setIsSavingLeadDraft(true);
    try {
      const normalizedName = [leadDraft.first_name || '', leadDraft.last_name || ''].join(' ').trim() || leadDraft.name;
      const payload = {
        name: normalizedName,
        first_name: leadDraft.first_name || null,
        last_name: leadDraft.last_name || null,
        profession: leadDraft.profession || null,
        email: leadDraft.email || null,
        phone: leadDraft.phone || null,
        location: leadDraft.location || null,
        address: leadDraft.address || null,
        client_reference: leadDraft.client_reference || null,
        secure_info: leadDraft.secure_info || null,
        last_activity: new Date().toISOString(),
      };

      const { error } = await supabase.from('leads').update(payload).eq('id', selectedLead.id);
      if (error) throw error;

      const updatedLead: Lead = {
        ...selectedLead,
        ...leadDraft,
        name: normalizedName,
      };
      setSelectedLead(updatedLead);
      setLeadDraft(updatedLead);
      setLeads((prev) => prev.map((item) => (item.id === selectedLead.id ? updatedLead : item)));
      addNotification('success', 'Informations lead mises à jour.');
    } catch (error: any) {
      addNotification('error', error?.message || 'Impossible de sauvegarder le lead.');
    } finally {
      setIsSavingLeadDraft(false);
    }
  };

  const handleCall = async (lead: Lead, e: React.MouseEvent) => {
    e.stopPropagation();
    if (isRepresentant) {
        addNotification('error', "Le rôle Représentant ne peut pas initier d'actions modifiant le lead.");
        return;
    }
    
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
    setCanRenderPortal(true);
  }, []);

  useEffect(() => {
    let interval: any;
    if (isCallModalOpen && !isInitiatingCall) { setCallTimer(0); interval = setInterval(() => setCallTimer(p => p + 1), 1000); }
    return () => clearInterval(interval);
  }, [isCallModalOpen, isInitiatingCall]);

  useEffect(() => {
    const pageChanged = previousPageRef.current !== currentPage;
    previousPageRef.current = currentPage;
    if (!pageChanged) return;

    leadsTableTopRef.current?.scrollIntoView({ behavior: 'auto', block: 'start' });
  }, [currentPage]);
  
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
      <div ref={leadsTableTopRef} />

      <Card noPadding className="min-h-[420px] overflow-hidden border-slate-200">
        <div className="flex flex-col gap-3 border-b border-border bg-slate-50/50 p-3.5 sm:flex-row sm:items-center sm:justify-between motion-fade-up">
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
          <div className="flex w-full items-center gap-1.5 sm:w-auto sm:flex-nowrap sm:justify-end">
            <input
              type="number"
              min="1"
              max={pagedLeads.length}
              value={selectCount}
              onChange={(e) => setSelectCount(e.target.value)}
              placeholder="#"
              className="ui-input h-9 w-12 px-1 text-center text-xs [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              onKeyDown={(e) => e.key === 'Enter' && handleQuickSelect()}
            />
            <button onClick={handleQuickSelect} className="ui-btn ui-btn-secondary h-9 min-w-[50px] px-2.5 py-0 text-xs motion-soft-hover motion-soft-press whitespace-nowrap">
              OK
            </button>
            <button
              onClick={() => {
                setSelectAllFiltered(true);
                setSelectedLeadIds([]);
                setExcludedLeadIds([]);
                addNotification('info', `Tous les leads filtrés sont sélectionnés (${totalFilteredLeads}).`);
              }}
              className="inline-flex h-9 min-w-[84px] items-center justify-center rounded-md border border-zinc-200 bg-white px-2.5 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-800 whitespace-nowrap"
              title={`Tout sélectionner (${totalFilteredLeads})`}
            >
              Tout ({totalFilteredLeads})
            </button>
            {selectAllFiltered ? (
              <button
                onClick={clearBulkSelection}
                className="inline-flex h-9 min-w-[62px] items-center justify-center rounded-md border border-zinc-200 bg-white px-2.5 text-xs font-medium text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-700 whitespace-nowrap"
              >
                Reset
              </button>
            ) : null}
          </div>
        </div>
        {loading ? (
            <SectionLoader className="m-4 py-10" />
        ) : schemaError ? (
            <div className="ui-state-box ui-state-error m-4 text-center">
                <p className="ui-state-title">Erreur de compatibilité</p>
                <p className="ui-state-text">Impossible de charger les leads avec le schéma actuel.</p>
            </div>
        ) : totalFilteredLeads === 0 ? (
            <div className="ui-state-box ui-state-empty m-4 flex flex-col items-center justify-center py-20 text-center">
                <Users size={24} className="text-gray-400 mb-4" />
                <p className="ui-state-title">Aucun lead trouvé</p>
                <p className="ui-state-text">Essayez de modifier vos filtres.</p>
            </div>
        ) : (
            <>
            <div className="overflow-x-hidden">
            <table className="ui-table w-full table-fixed text-left text-sm">
            <thead className="border-b border-border">
                <tr>
                <th className="w-12 px-3 py-3 text-[12px] font-semibold text-zinc-500 md:px-6">
                     <div
                        className={`w-4 h-4 rounded-sm border flex items-center justify-center cursor-pointer transition-colors ${
                          pagedLeads.length > 0 && pagedLeads.every((lead) =>
                            selectAllFiltered ? !excludedLeadIds.includes(lead.id) : selectedLeadIds.includes(lead.id),
                          )
                            ? 'bg-zinc-800 border-zinc-800 text-white'
                            : 'border-zinc-300 bg-white'
                        }`}
                        onClick={handleSelectAll}
                     >
                         {pagedLeads.length > 0 && pagedLeads.every((lead) =>
                           selectAllFiltered ? !excludedLeadIds.includes(lead.id) : selectedLeadIds.includes(lead.id),
                         ) && <Check size={10} />}
                     </div>
                </th>
                <th className="w-[33%] px-3 py-3 text-[12px] font-semibold text-zinc-500 md:px-6">Nom</th>
                <th className="w-[14%] px-3 py-3 text-[12px] font-semibold text-zinc-500 md:px-5">Profession</th>
                <th className="w-[16%] px-3 py-3 text-[12px] font-semibold text-zinc-500 md:px-5">Localisation</th>
                <th className="w-[12%] px-3 py-3 text-[12px] font-semibold text-zinc-500 md:px-4">Statut</th>
                <th className="w-[15%] px-3 py-3 text-[12px] font-semibold text-zinc-500 md:px-4">Responsable</th>
                <th className="w-[10%] px-2 py-3 text-right text-[12px] font-semibold text-zinc-500 md:px-4">Actions</th>
                </tr>
            </thead>
            <tbody className="divide-y divide-border">
                {pagedLeads.map((lead, idx) => {
                  const isSelected = selectAllFiltered ? !excludedLeadIds.includes(lead.id) : selectedLeadIds.includes(lead.id);
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
                            {(leadTrainingsByLeadId[lead.id] ?? []).length > 0 ? (
                              <div className="mt-1 flex flex-wrap gap-1">
                                {(leadTrainingsByLeadId[lead.id] ?? []).slice(0, 2).map((training) => (
                                  <span key={training.title} className="max-w-[180px] truncate rounded border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 text-[10px] text-zinc-600">
                                    {training.title}
                                  </span>
                                ))}
                                {(leadTrainingsByLeadId[lead.id] ?? []).length > 2 ? (
                                  <span className="rounded bg-white px-1.5 py-0.5 text-[10px] text-zinc-500">
                                    +{(leadTrainingsByLeadId[lead.id] ?? []).length - 2}
                                  </span>
                                ) : null}
                              </div>
                            ) : null}
                            </div>
                        </div>
                        </td>
                        <td className="truncate px-3 py-3 text-secondary md:px-5">{lead.profession || lead.specialty}</td>
                        <td className="truncate px-3 py-3 text-secondary md:px-5">{lead.location}</td>
                        <td className="px-3 py-3 md:px-4">
                        <Badge className="border-transparent" variant={lead.status === 'qualified' || lead.status === 'won' ? 'success' : lead.status === 'contacted' ? 'blue' : lead.status === 'closed' ? 'neutral' : lead.status === 'lost' ? 'warning' : 'neutral'}>
                            {lead.status === 'qualified' ? 'Qualifié' : lead.status === 'won' ? 'Gagné' : lead.status === 'contacted' ? 'Contacté' : lead.status === 'closed' ? 'Fermé' : lead.status === 'lost' ? 'Perdu' : 'Nouveau'}
                        </Badge>
                        </td>
                        <td className="px-3 py-3 md:px-4">
                            {lead.assignee ? (
                                <div className="flex items-center gap-2" title={lead.assignee.full_name}>
                                    <Avatar name={lead.assignee.full_name || 'U'} src={lead.assignee.avatar_url || null} size="sm" />
                                    <span className="text-xs text-secondary truncate max-w-[80px] hidden xl:block">{lead.assignee.full_name}</span>
                                </div>
                            ) : <span className="text-xs text-gray-300">-</span>}
                        </td>
                        <td className="px-2 py-3 text-right md:px-4">
                        <div className="ui-table-action flex items-center justify-end gap-1.5 whitespace-nowrap">
                            <button onClick={(e) => handleCall(lead, e)} className="ui-focus rounded-md p-1.5 text-zinc-500 transition-colors hover:bg-emerald-50 hover:text-emerald-600"><Phone size={16} strokeWidth={1.5} /></button>
                            <button onClick={(e) => handleEmail(lead, e)} className="ui-focus rounded-md p-1.5 text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-700"><Mail size={16} strokeWidth={1.5} /></button>
                        </div>
                        </td>
                    </tr>
                )})}
            </tbody>
            </table>
            </div>

            {totalFilteredLeads > LEADS_PAGE_SIZE ? (
              <div className="flex items-center justify-between border-t border-border bg-slate-50/40 px-3 py-2 md:px-6">
                <p className="text-[11px] text-zinc-500">
                  {pageStartIndex + 1}-{Math.min(pageStartIndex + pagedLeads.length, totalFilteredLeads)} sur {totalFilteredLeads}
                </p>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                    disabled={safeCurrentPage <= 1}
                    className="inline-flex h-8 items-center rounded-md border border-zinc-200 bg-white px-2.5 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-100 disabled:opacity-50"
                  >
                    Précédent
                  </button>
                  <span className="rounded bg-zinc-100 px-2 py-1 text-[11px] font-medium text-zinc-700">
                    Page {safeCurrentPage}/{totalPages}
                  </span>
                  <button
                    onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                    disabled={safeCurrentPage >= totalPages}
                    className="inline-flex h-8 items-center rounded-md border border-zinc-200 bg-white px-2.5 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-100 disabled:opacity-50"
                  >
                    Suivant
                  </button>
                </div>
              </div>
            ) : null}
            </>
        )}
      </Card>

      {selectedCount > 0 && canRenderPortal && createPortal(
          <div className="fixed inset-x-0 bottom-6 z-[70] flex justify-center px-4 pointer-events-none">
            <div className="pointer-events-auto flex items-center gap-3 rounded-md border border-zinc-800/10 bg-white/95 px-3.5 py-2 shadow-float backdrop-blur-sm motion-scale-in">
                <span className="whitespace-nowrap text-[12px] font-semibold text-zinc-800">{selectedCount} sélectionné(s)</span>
                
                <div className="h-4 w-px bg-gray-200"></div>
                
                <button 
                    onClick={() => setIsBulkAssignModalOpen(true)}
                    className="ui-focus inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[12px] font-medium text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900 motion-soft-hover motion-soft-press"
                >
                    <Share2 size={16} /> Assigner
                </button>
                
                <div className="h-4 w-px bg-gray-200"></div>

                <button 
                    onClick={executeBulkDelete}
                    disabled={isProcessingBulk}
                    className="ui-focus inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[12px] font-medium text-rose-600 transition-colors hover:bg-rose-50 hover:text-rose-700 motion-soft-hover motion-soft-press disabled:opacity-50"
                >
                    {isProcessingBulk ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={16} />} {isProcessingBulk ? 'Suppression...' : 'Supprimer'}
                </button>
                
                <div className="h-4 w-px bg-gray-200"></div>

                <button 
                    onClick={clearBulkSelection}
                    className="ui-focus inline-flex h-8 items-center rounded-md px-2 text-gray-400 transition-colors hover:bg-zinc-100 hover:text-gray-600 motion-soft-hover motion-soft-press"
                >
                    <X size={16} />
                </button>
            </div>
          </div>,
          document.body
      )}

      <Modal isOpen={isBulkAssignModalOpen} onClose={() => setIsBulkAssignModalOpen(false)}>
          <div className="w-full max-w-lg rounded-md bg-surface p-6">
              <div className="mb-5 border-b border-zinc-200 pb-3">
                <h3 className="text-lg font-medium text-primary">Assignation de masse</h3>
                <p className="mt-1 text-sm text-secondary">Comment souhaitez-vous répartir les {selectedCount} leads sélectionnés ?</p>
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

      <Modal isOpen={isCsvMappingModalOpen} onClose={() => setIsCsvMappingModalOpen(false)} maxWidth="2xl">
        <div className="w-full rounded-md bg-surface p-5">
          <div className="mb-5 border-b border-zinc-200 pb-3">
            <h3 className="text-lg font-medium text-primary">Mapping CSV</h3>
            <p className="mt-1 text-sm text-secondary">
              Associez chaque colonne CSV au bon champ avant import.
            </p>
          </div>

          <div className="mb-3 rounded-md border border-zinc-200 bg-white">
            <div className="border-b border-zinc-200 px-3 py-2">
              <p className="text-xs font-semibold uppercase tracking-[0.06em] text-zinc-600">Colonnes détectées</p>
            </div>
            <div className="max-h-[36vh] overflow-y-auto">
              <table className="min-w-full text-left text-xs">
                <thead className="sticky top-0 bg-zinc-50">
                  <tr className="border-b border-zinc-200 text-zinc-600">
                    <th className="px-3 py-2 font-semibold">Colonne CSV</th>
                    <th className="px-3 py-2 font-semibold">Champ cible</th>
                    <th className="px-3 py-2 font-semibold">Exemple</th>
                  </tr>
                </thead>
                <tbody>
                  {csvHeaders.map((header, idx) => (
                    <tr key={header} className="border-b border-zinc-100 last:border-b-0">
                      <td className="px-3 py-2 align-top text-zinc-700">{header}</td>
                      <td className="px-3 py-2">
                        <select
                          value={csvMapping[header] ?? 'ignore'}
                          onChange={(e) =>
                            setCsvMapping((prev) => ({
                              ...prev,
                              [header]: e.target.value as CsvFieldKey,
                            }))
                          }
                          className="ui-input h-8 min-h-0 py-1 text-xs"
                        >
                          {CSV_FIELD_OPTIONS.map((option) => (
                            <option key={`${header}-${option.value}`} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="max-w-[280px] truncate px-3 py-2 text-zinc-500">{csvRows[0]?.[idx] || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-zinc-200 bg-zinc-50/60 px-3 py-2">
            <div className="flex flex-wrap items-center gap-3">
              <label className="inline-flex items-center gap-1.5 text-sm text-primary">
                <input
                  type="radio"
                  name="duplicate-strategy"
                  checked={duplicateStrategy === 'skip'}
                  onChange={() => setDuplicateStrategy('skip')}
                />
                Ignorer
              </label>
              <label className="inline-flex items-center gap-1.5 text-sm text-primary">
                <input
                  type="radio"
                  name="duplicate-strategy"
                  checked={duplicateStrategy === 'overwrite'}
                  onChange={() => setDuplicateStrategy('overwrite')}
                />
                Écraser
              </label>
              <label className="inline-flex items-center gap-1.5 text-sm text-primary">
                <input
                  type="radio"
                  name="duplicate-strategy"
                  checked={duplicateStrategy === 'import_all'}
                  onChange={() => setDuplicateStrategy('import_all')}
                />
                Importer quand même
              </label>
            </div>
            <p className="text-[11px] text-secondary">Détection: email/téléphone</p>
          </div>

          <div className="mb-3 flex flex-wrap items-center gap-1.5 pb-1 text-[11px]">
            <span className="rounded bg-zinc-50 px-1.5 py-0.5 text-zinc-700">Valides: <strong>{csvImportPreview.totalValidRows}</strong></span>
            <span className="rounded bg-zinc-50 px-1.5 py-0.5 text-zinc-700">Doublons CRM: <strong>{csvImportPreview.existingDuplicates}</strong></span>
            <span className="rounded bg-zinc-50 px-1.5 py-0.5 text-zinc-700">Doublons CSV: <strong>{csvImportPreview.fileDuplicates}</strong></span>
            <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-emerald-800">Ajouts: <strong>{csvImportPreview.projectedInsert}</strong></span>
            <span className="rounded bg-blue-50 px-1.5 py-0.5 text-blue-800">Mises à jour: <strong>{csvImportPreview.projectedUpdate}</strong></span>
            <span className="rounded bg-amber-50 px-1.5 py-0.5 text-amber-800">Ignorés: <strong>{csvImportPreview.projectedSkip}</strong></span>
          </div>

          <div className="flex justify-end gap-2 border-t border-zinc-200 pt-4">
            <button onClick={() => setIsCsvMappingModalOpen(false)} className="ui-btn ui-btn-secondary">Annuler</button>
            <button onClick={handleConfirmCsvImport} disabled={isImporting} className="ui-btn ui-btn-primary disabled:opacity-50">
              {isImporting ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
              Importer
            </button>
          </div>
        </div>
      </Modal>

      <SlideOver isOpen={!!selectedLead} onClose={() => setSelectedLead(null)} title="Dossier Prospect">
        {selectedLead && leadDraft && (
          <div className="space-y-8 pb-10">
            <div className="flex items-start justify-between gap-4">
               <div className="flex items-center gap-4">
                    <Avatar name={leadDraft.name || selectedLead.name} size="lg" />
                    <div>
                        <h3 className="text-xl font-medium text-primary">{leadDraft.name || selectedLead.name}</h3>
                        <p className="text-secondary flex items-center gap-1.5 mt-0.5 text-sm"><Briefcase size={12} /> {leadDraft.profession || leadDraft.specialty || 'Profession non renseignée'}</p>
                        <p className="text-secondary flex items-center gap-1.5 mt-0.5 text-xs"><MapPin size={12} /> {leadDraft.address || leadDraft.location || 'Adresse inconnue'}</p>
                    </div>
               </div>
               <div>
                   <select value={selectedLead.status} onChange={handleStatusChange} disabled={isRepresentant} className="block w-32 py-1.5 px-3 text-sm border border-border bg-white rounded-md focus:outline-none focus:ring-1 focus:ring-primary disabled:cursor-not-allowed disabled:opacity-60">
                       <option value="new">Nouveau</option>
                       <option value="contacted">Contacté</option>
                       <option value="qualified">Qualifié</option>
                       <option value="won">Gagné</option>
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
                    disabled={profile?.role === 'commercial' || isRepresentant} 
                    className="bg-transparent text-sm font-medium text-primary outline-none text-right cursor-pointer hover:underline disabled:cursor-not-allowed w-1/2"
                >
                    <option value="">Non assigné</option>
                    {users.map(u => (<option key={u.id} value={u.id}>{u.full_name || u.email}</option>))}
                </select>
            </div>

            {!isRepresentant ? (
            <div className="p-4 bg-gray-900 rounded-lg text-white">
                <div className="flex items-start gap-3">
                    <div className="p-2 bg-gray-800 rounded-md"><Kanban size={18} /></div>
                    <div className="flex-1">
                        <h4 className="text-sm font-medium mb-1">Convertir en opportunité</h4>
                        <button onClick={() => { setIsConvertModalOpen(true); setSelectedTrainingIds([]); }} className="w-full mt-2 py-2 bg-white text-black text-sm font-medium rounded-md hover:bg-gray-200 transition-colors flex items-center justify-center gap-2">Créer une opportunité <ArrowRight size={14} /></button>
                    </div>
                </div>
            </div>
            ) : null}

            {selectedLead.status === 'won' && (
              <div className="space-y-3 rounded-md border border-zinc-200 bg-zinc-50 p-4">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold text-primary uppercase tracking-wide">Informations vente</h4>
                  {leadWonInfo && (
                    <button onClick={() => setIsLeadWonInfoModalOpen(true)} className="ui-btn ui-btn-secondary h-8 px-3 py-0 text-xs">
                      Voir tout
                    </button>
                  )}
                </div>
                {loadingLeadWonInfo ? (
                  <p className="text-sm text-secondary">Chargement...</p>
                ) : leadWonInfo ? (
                  <div className="grid grid-cols-1 gap-2 text-sm md:grid-cols-2">
                    <p><span className="text-secondary">Opportunité:</span> {leadWonInfo.deals?.title || '-'}</p>
                    <p><span className="text-secondary">Montant:</span> {leadWonInfo.deals?.amount?.toLocaleString?.() ?? '-'} €</p>
                    <p><span className="text-secondary">Session:</span> {leadWonInfo.session_label || '-'}</p>
                    <p><span className="text-secondary">Preuve:</span> {leadWonInfo.proof_url ? <a href={leadWonInfo.proof_url} target="_blank" rel="noreferrer" className="text-primary underline">Ouvrir</a> : '-'}</p>
                    <div className="md:col-span-2">
                      <span className="text-secondary">Formations & organismes:</span>
                      {leadWonTrainings.length > 0 ? (
                        <div className="mt-1 space-y-1">
                          {leadWonTrainings.map((training) => (
                            <p key={training.title} className="text-sm text-primary">
                              {training.title} <span className="text-secondary">— {training.organization || 'Organisme non renseigné'}</span>
                            </p>
                          ))}
                        </div>
                      ) : (
                        <span className="ml-1">-</span>
                      )}
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-secondary">Aucune information vente enregistrée.</p>
                )}
              </div>
            )}

            <div className="space-y-2 rounded-md border border-zinc-200 bg-zinc-50 p-4">
              <h4 className="text-sm font-semibold text-primary uppercase tracking-wide">Formations associées</h4>
              {getDisplayedLeadTrainings(selectedLead.id, selectedLead.status === 'won').length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {getDisplayedLeadTrainings(selectedLead.id, selectedLead.status === 'won').map((training) => (
                    <span key={training.title} className="inline-flex items-center rounded border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-700">
                      {training.title}
                      <span className="mx-1 text-zinc-400">•</span>
                      <span className="text-zinc-500">{training.organization || 'Organisme non renseigné'}</span>
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-secondary">Aucune formation associée.</p>
              )}
            </div>

            <div className="space-y-4">
                <h4 className="text-sm font-medium text-primary uppercase tracking-wide">Informations Détaillées</h4>
                <div className="grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
                    <div>
                      <label className="ui-field-label">Prénom</label>
                      <input value={leadDraft.first_name || ''} onChange={(e) => updateLeadDraft('first_name', e.target.value)} className="ui-input" />
                    </div>
                    <div>
                      <label className="ui-field-label">Nom</label>
                      <input value={leadDraft.last_name || ''} onChange={(e) => updateLeadDraft('last_name', e.target.value)} className="ui-input" />
                    </div>
                    <div>
                      <label className="ui-field-label">Profession</label>
                      <input value={leadDraft.profession || ''} onChange={(e) => updateLeadDraft('profession', e.target.value)} className="ui-input" />
                    </div>
                    <div>
                      <label className="ui-field-label">Réf. Client</label>
                      <input value={leadDraft.client_reference || ''} onChange={(e) => updateLeadDraft('client_reference', e.target.value)} className="ui-input" />
                    </div>
                    <div>
                      <label className="ui-field-label">Email</label>
                      <input value={leadDraft.email || ''} onChange={(e) => updateLeadDraft('email', e.target.value)} className="ui-input" />
                    </div>
                    <div>
                      <label className="ui-field-label">Téléphone</label>
                      <input value={leadDraft.phone || ''} onChange={(e) => updateLeadDraft('phone', e.target.value)} className="ui-input" />
                    </div>
                    <div>
                      <label className="ui-field-label">Ville</label>
                      <input value={leadDraft.location || ''} onChange={(e) => updateLeadDraft('location', e.target.value)} className="ui-input" />
                    </div>
                    <div>
                      <label className="ui-field-label">Adresse</label>
                      <input value={leadDraft.address || ''} onChange={(e) => updateLeadDraft('address', e.target.value)} className="ui-input" />
                    </div>
                    <div className="rounded-md border border-yellow-100 bg-yellow-50/50 p-3 md:col-span-2">
                      <label className="mb-1 flex items-center gap-1 text-xs font-semibold uppercase tracking-[0.06em] text-yellow-800">
                        <Lock size={10} /> Info Sécurisée
                      </label>
                      <input
                        value={leadDraft.secure_info || ''}
                        onChange={(e) => updateLeadDraft('secure_info', e.target.value)}
                        className="ui-input border-yellow-200 bg-white"
                        placeholder="Non renseignée"
                      />
                    </div>
                    {!isRepresentant ? (
                    <div className="flex justify-end md:col-span-2">
                      <button onClick={saveLeadDraft} disabled={isSavingLeadDraft} className="ui-btn ui-btn-primary disabled:opacity-50">
                        {isSavingLeadDraft ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                        Enregistrer
                      </button>
                    </div>
                    ) : null}
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

      <Modal isOpen={isLeadWonInfoModalOpen} onClose={() => setIsLeadWonInfoModalOpen(false)} maxWidth="2xl">
        <div className="w-full rounded-md bg-white p-6">
          <h3 className="mb-4 text-lg font-medium text-primary">Informations vente (détail)</h3>
          {leadWonInfo ? (
            <div className="grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
              <p><span className="text-secondary">Opportunité:</span> {leadWonInfo.deals?.title || '-'}</p>
              <p><span className="text-secondary">Montant:</span> {leadWonInfo.deals?.amount?.toLocaleString?.() ?? '-'} €</p>
              <p><span className="text-secondary">Session:</span> {leadWonInfo.session_label || '-'}</p>
              <p><span className="text-secondary">1ère connexion faite:</span> {leadWonInfo.first_connection_done ? 'Oui' : 'Non'}</p>
              <p><span className="text-secondary">Date 1ère connexion:</span> {leadWonInfo.first_connection_date || '-'}</p>
              <p><span className="text-secondary">Heure 1ère connexion:</span> {leadWonInfo.first_connection_time || '-'}</p>
              <p><span className="text-secondary">Enregistrement 1:</span> {leadWonInfo.recording_1_url ? <a href={leadWonInfo.recording_1_url} target="_blank" rel="noreferrer" className="text-primary underline">Ouvrir</a> : '-'}</p>
              <p><span className="text-secondary">Enregistrement 2:</span> {leadWonInfo.recording_2_url ? <a href={leadWonInfo.recording_2_url} target="_blank" rel="noreferrer" className="text-primary underline">Ouvrir</a> : '-'}</p>
              <p><span className="text-secondary">Screen preuve:</span> {leadWonInfo.proof_url ? <a href={leadWonInfo.proof_url} target="_blank" rel="noreferrer" className="text-primary underline">Ouvrir</a> : '-'}</p>
              <div className="md:col-span-2">
                <span className="text-secondary">Formations & organismes:</span>
                {leadWonTrainings.length > 0 ? (
                  <div className="mt-1 space-y-1">
                    {leadWonTrainings.map((training) => (
                      <p key={training.title}>
                        {training.title} <span className="text-secondary">— {training.organization || 'Organisme non renseigné'}</span>
                      </p>
                    ))}
                  </div>
                ) : (
                  <span className="ml-1">-</span>
                )}
              </div>
              <p><span className="text-secondary">Commentaire vente:</span> {leadWonInfo.sale_comment || '-'}</p>
              <p><span className="text-secondary">Commentaire suivi:</span> {leadWonInfo.followup_comment || '-'}</p>
              <p><span className="text-secondary">Commentaire organisme:</span> {leadWonInfo.organization_comment || '-'}</p>
              <p className="md:col-span-2"><span className="text-secondary">Commentaire désinscription:</span> {leadWonInfo.unsubscription_comment || '-'}</p>
            </div>
          ) : (
            <p className="text-sm text-secondary">Aucune donnée.</p>
          )}
          <div className="mt-6 flex justify-end">
            <button onClick={() => setIsLeadWonInfoModalOpen(false)} className="ui-btn ui-btn-primary">Fermer</button>
          </div>
        </div>
      </Modal>

      <SlideOver isOpen={isCreateModalOpen} onClose={() => setIsCreateModalOpen(false)} title="Nouveau Contact" maxWidth="2xl">
            <p className="mb-5 text-sm text-secondary">Créez un lead avec les informations essentielles.</p>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="rounded-md border border-zinc-200 bg-zinc-50/60 p-3 md:col-span-2">
                    <label className="ui-field-label">Assigné à</label>
                    <select value={newLead.user_id} onChange={(e) => setNewLead({...newLead, user_id: e.target.value})} disabled={profile?.role === 'commercial' || profile?.role === 'representant'} className="ui-input">
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
                    <button onClick={handleCreateLead} disabled={isRepresentant} className="ui-btn ui-btn-primary disabled:cursor-not-allowed disabled:opacity-60">Créer</button>
                </div>
            </div>
      </SlideOver>

      <Modal isOpen={isConvertModalOpen} onClose={() => setIsConvertModalOpen(false)} maxWidth="lg">
        <div className="w-full rounded-md bg-white p-6">
          <div className="mb-4 border-b border-zinc-200 pb-3">
            <h3 className="text-lg font-medium text-primary">Créer une opportunité</h3>
            <p className="mt-1 text-sm text-secondary">
              {selectedLead ? `Conversion de "${selectedLead.name}" vers le pipeline.` : 'Aucun lead sélectionné.'}
            </p>
          </div>

          <div className="space-y-4">
            <div>
              <label className="ui-field-label">Formations associées</label>
              <div className="relative" ref={dropdownRef}>
                <button
                  type="button"
                  onClick={() => setShowTrainingDropdown((prev) => !prev)}
                  className="ui-input flex h-10 w-full items-center justify-between"
                >
                  <span className="truncate text-left text-sm text-zinc-700">
                    {selectedTrainingIds.length > 0 ? `${selectedTrainingIds.length} formation(s) sélectionnée(s)` : 'Sélectionner des formations'}
                  </span>
                  <ArrowRight size={14} className={`transition-transform ${showTrainingDropdown ? 'rotate-90' : ''}`} />
                </button>
                {showTrainingDropdown ? (
                  <div className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-zinc-200 bg-white p-2 shadow-card">
                    <input
                      value={trainingSearch}
                      onChange={(e) => setTrainingSearch(e.target.value)}
                      placeholder="Rechercher une formation..."
                      className="ui-input mb-2"
                    />
                    <div className="space-y-1">
                      {trainings
                        .filter((t) => t.title.toLowerCase().includes(trainingSearch.toLowerCase()))
                        .map((training) => {
                          const checked = selectedTrainingIds.includes(training.id);
                          return (
                            <label
                              key={training.id}
                              className="flex cursor-pointer items-center justify-between rounded-md px-2 py-1.5 text-sm hover:bg-zinc-50"
                            >
                              <span className="truncate text-zinc-700">{training.title}</span>
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggleTrainingSelection(training.id)}
                                className="h-4 w-4 accent-zinc-800"
                              />
                            </label>
                          );
                        })}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>

            <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3">
              <p className="text-xs text-zinc-500">Montant calculé</p>
              <p className="text-lg font-semibold text-zinc-900">
                {trainings
                  .filter((t) => selectedTrainingIds.includes(t.id))
                  .reduce((sum, t) => sum + t.price, 0)
                  .toLocaleString()} €
              </p>
            </div>
          </div>

          <div className="mt-5 flex justify-end gap-2 border-t border-zinc-200 pt-4">
            <button
              onClick={() => {
                setIsConvertModalOpen(false);
                setShowTrainingDropdown(false);
                setTrainingSearch('');
              }}
              className="ui-btn ui-btn-secondary"
            >
              Annuler
            </button>
            <button onClick={handleConvertToDeal} className="ui-btn ui-btn-primary">
              Créer l&apos;opportunité
            </button>
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
