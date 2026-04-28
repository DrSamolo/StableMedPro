import React, { useState, useEffect, useRef } from 'react';
import { SectionTitle, Modal, SlideOver, Avatar, SectionLoader } from '@/components/Common';
import { FilterBar } from '@/components/FilterBar';
import { Deal, Training } from '@/types';
import { MoreHorizontal, Plus, Loader2, Trash2, Save, Calendar, DollarSign, TrendingUp, CheckCircle, Search, X, Check, Award, PartyPopper, AlertCircle, RefreshCw, ChevronDown } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useNotification } from '@/contexts/NotificationContext';
import { useData } from '@/contexts/DataContext';
import { TaskModal } from '@/components/tasks/task-modal';
import { getCached, invalidateCached, setCached } from '@/lib/perf/cache';
import { perfEnd, perfStart } from '@/lib/perf/metrics';
import { useSectionPerf } from '@/lib/perf/use-section-perf';

const DEALS_CACHE_TTL_MS = 45_000;
const TRAININGS_CACHE_TTL_MS = 3 * 60_000;
const PIPELINE_COMPAT_CACHE_TTL_MS = 10 * 60_000;
const PIPELINE_PAGE_SIZE = 120;
const PIPELINE_MAX_ROWS = 800;
const euroNumberFormatter = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
const toWholeEuro = (value: unknown): number => {
  const amount = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(amount) ? Math.trunc(amount) : 0;
};
const formatEuro = (value: unknown): string => `${euroNumberFormatter.format(toWholeEuro(value))} €`;

interface PipelineColumnProps {
  title: string;
  stage: Deal['stage'];
  deals: Deal[];
  totalValue: number;
  onDrop: (e: React.DragEvent, stage: Deal['stage']) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragStart: (e: React.DragEvent, id: string) => void;
  onOpenCreate: () => void;
  onSelectDeal: (deal: Deal) => void;
}

type LeadOption = {
  id: string;
  name: string;
  user_id: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  profession: string | null;
  location: string | null;
  address: string | null;
  client_reference: string | null;
  secure_info: string | null;
};

type OpportunityLeadDraft = {
  first_name: string;
  last_name: string;
  profession: string;
  email: string;
  phone: string;
  location: string;
  address: string;
  client_reference: string;
  secure_info: string;
};

const buildEmptyOpportunityLeadDraft = (): OpportunityLeadDraft => ({
  first_name: '',
  last_name: '',
  profession: '',
  email: '',
  phone: '',
  location: '',
  address: '',
  client_reference: '',
  secure_info: '',
});

type SaleCaptureMode = 'direct' | 'existing_deal';

type SaleCaptureForm = {
  client_name: string;
  owner_id: string;
  training_ids: string[];
  amount: number;
  session_label: string;
  first_connection_date: string;
  first_connection_time: string;
  first_connection_done: boolean;
  recording_1_url: string;
  recording_1_file_ref: string;
  recording_2_url: string;
  recording_2_file_ref: string;
  proof_url: string;
  proof_file_ref: string;
  sale_comment: string;
  followup_comment: string;
  organization_comment: string;
  unsubscription_comment: string;
};
type SaleCaptureAssetBaseline = Pick<
  SaleCaptureForm,
  | 'recording_1_url'
  | 'recording_1_file_ref'
  | 'recording_2_url'
  | 'recording_2_file_ref'
  | 'proof_url'
  | 'proof_file_ref'
>;

type DealWinDetailsRecord = {
  id: string;
  session_label: string | null;
  first_connection_date: string | null;
  first_connection_time: string | null;
  first_connection_done: boolean;
  recording_1_url: string | null;
  recording_1_file_ref: string | null;
  recording_2_url: string | null;
  recording_2_file_ref: string | null;
  proof_url: string | null;
  proof_file_ref: string | null;
  sale_comment: string | null;
  followup_comment: string | null;
  organization_comment: string | null;
  unsubscription_comment: string | null;
  created_at: string;
};

const buildEmptySaleCaptureForm = (): SaleCaptureForm => ({
  client_name: '',
  owner_id: '',
  training_ids: [],
  amount: 0,
  session_label: '',
  first_connection_date: '',
  first_connection_time: '',
  first_connection_done: false,
  recording_1_url: '',
  recording_1_file_ref: '',
  recording_2_url: '',
  recording_2_file_ref: '',
  proof_url: '',
  proof_file_ref: '',
  sale_comment: '',
  followup_comment: '',
  organization_comment: '',
  unsubscription_comment: '',
});
const buildEmptySaleCaptureAssetBaseline = (): SaleCaptureAssetBaseline => ({
  recording_1_url: '',
  recording_1_file_ref: '',
  recording_2_url: '',
  recording_2_file_ref: '',
  proof_url: '',
  proof_file_ref: '',
});

const PipelineColumn: React.FC<PipelineColumnProps> = ({ 
  title, 
  stage, 
  deals, 
  totalValue, 
  onDrop, 
  onDragOver, 
  onDragStart,
  onOpenCreate,
  onSelectDeal
}) => (
  <div 
    className="flex h-full min-w-0 w-full flex-col rounded-md border border-zinc-200 bg-zinc-50/40 p-2.5 motion-fade-up"
    onDrop={(e) => onDrop(e, stage)}
    onDragOver={onDragOver}
  >
    <div className="mb-3 flex items-center justify-between px-1 pt-1.5">
      <h3 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-zinc-500">
          {stage === 'won' && <Award size={13} className="text-zinc-500" />}
          {title} 
          <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-white px-1.5 text-[10px] font-semibold text-zinc-500">{deals.length}</span>
      </h3>
      <span className="text-[11px] font-medium tabular-nums text-zinc-500">{formatEuro(totalValue)}</span>
    </div>
    <div className="flex-1 space-y-2.5 overflow-y-auto px-0.5">
      {deals.map((deal, idx) => (
        <div 
          key={deal.id} 
          draggable
          onDragStart={(e) => onDragStart(e, deal.id)}
          onClick={() => onSelectDeal(deal)}
          className="group relative cursor-grab rounded-md border border-zinc-200 bg-white p-3.5 shadow-subtle transition-all duration-200 hover:-translate-y-0.5 hover:border-zinc-300 hover:shadow-card active:cursor-grabbing micro-interaction motion-fade-up"
          style={{ animationDelay: `${idx * 50}ms` }}
        >
          <div className="mb-2 flex items-start justify-between">
            <div className="flex flex-col gap-1">
                {deal.trainings && deal.trainings.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                        {deal.trainings.slice(0, 1).map((t, idx) => (
                            <span key={idx} className="max-w-[150px] truncate rounded bg-zinc-50 px-1.5 py-0.5 text-[10px] text-zinc-600">
                                {t.title}
                            </span>
                        ))}
                        {deal.trainings.length > 1 && (
                            <span className="rounded bg-white px-1.5 py-0.5 text-[10px] text-zinc-500">
                                +{deal.trainings.length - 1}
                            </span>
                        )}
                    </div>
                ) : (
                    // Fallback for Legacy Data (String)
                    deal.training ? (
                         <span className="inline-block max-w-[150px] truncate rounded bg-zinc-50 px-1.5 py-0.5 text-[10px] text-zinc-500">{deal.training}</span>
                    ) : (
                         <span className="text-[11px] text-zinc-500 italic">Sans formation</span>
                    )
                )}
            </div>
            {deal.assignee ? (
                <div title={deal.assignee.full_name || deal.owner}>
                    <Avatar name={deal.assignee.full_name || deal.owner || 'U'} src={deal.assignee.avatar_url} size="sm" />
                </div>
            ) : (
                <div title="Non assigné">
                    <Avatar name="?" size="sm" />
                </div>
            )}
          </div>
          
          <h4 className="mb-0.5 truncate text-sm font-semibold leading-5 text-primary">{deal.leadName}</h4>
          <p className="truncate text-[12px] text-zinc-500">{deal.assignee?.full_name || deal.owner || "Non assigné"}</p>
          
          <div className="mt-2.5 flex items-center justify-between border-t border-zinc-100 pt-2.5">
            <div className="text-sm font-semibold tabular-nums text-zinc-900">{formatEuro(deal.amount)}</div>
            <div className="rounded-full bg-zinc-50 px-2 py-0.5 text-[11px] font-medium text-zinc-500">
                {deal.probability}%
            </div>
          </div>
        </div>
      ))}
      
      {deals.length === 0 && (
        <div className="motion-fade-up flex h-20 items-center justify-center rounded-md border border-dashed border-zinc-300 bg-white/65 text-[11px] font-medium text-zinc-500">
          Glisser ici
        </div>
      )}

      {stage === 'new' && (
        <button 
            onClick={onOpenCreate}
            className="micro-interaction motion-soft-hover motion-soft-press flex h-9 w-full items-center justify-center gap-2 rounded-md border border-dashed border-zinc-300 bg-white/70 text-[13px] font-medium text-zinc-500 transition-colors hover:border-zinc-400 hover:text-zinc-700"
        >
            <Plus size={14} /> Nouvelle
        </button>
      )}
    </div>
  </div>
);

const Pipeline: React.FC = () => {
  const { user, profile } = useAuth();
  const { selectedTeamId, selectedUserId, users } = useData();
  const { addNotification, pushAppNotification } = useNotification();
  
  const [deals, setDeals] = useState<Deal[]>([]);
  const [trainings, setTrainings] = useState<Training[]>([]);
  const [loading, setLoading] = useState(true);
  useSectionPerf('pipeline', loading);
  const [errorState, setErrorState] = useState(false);
  const [compatibilityMode, setCompatibilityMode] = useState(false);
  const [compatibilityError, setCompatibilityError] = useState<string>('');
  
  // Create Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newDealTitle, setNewDealTitle] = useState('');
  const [newDealAmount, setNewDealAmount] = useState(0);
  const [newDealOwner, setNewDealOwner] = useState('');
  const [newDealLeadId, setNewDealLeadId] = useState<string>('');
  const [leadOptions, setLeadOptions] = useState<LeadOption[]>([]);
  const [leadSearch, setLeadSearch] = useState('');
  const [showLeadDropdown, setShowLeadDropdown] = useState(false);
  const [opportunityLeadDraft, setOpportunityLeadDraft] = useState<OpportunityLeadDraft>(buildEmptyOpportunityLeadDraft());

  // Won Modal State
  const [isWonModalOpen, setIsWonModalOpen] = useState(false);
  const [wonDealSummary, setWonDealSummary] = useState<{ leadName: string; amount: number } | null>(null);

  // Sale capture workflow (must run before won side-effects)
  const [isSaleCaptureModalOpen, setIsSaleCaptureModalOpen] = useState(false);
  const [saleCaptureMode, setSaleCaptureMode] = useState<SaleCaptureMode>('direct');
  const [saleCaptureDeal, setSaleCaptureDeal] = useState<Deal | null>(null);
  const [saleCaptureLeadId, setSaleCaptureLeadId] = useState<string | null>(null);
  const [saleCaptureForm, setSaleCaptureForm] = useState<SaleCaptureForm>(buildEmptySaleCaptureForm());
  const [isSavingSaleCapture, setIsSavingSaleCapture] = useState(false);
  const [isUploadingSaleAsset, setIsUploadingSaleAsset] = useState(false);
  const [saleCaptureUrlHandled, setSaleCaptureUrlHandled] = useState(false);
  const [saleCaptureAssetBaseline, setSaleCaptureAssetBaseline] = useState<SaleCaptureAssetBaseline>(buildEmptySaleCaptureAssetBaseline());
  const normalizedRole = (profile?.role ?? '').trim().toLowerCase();
  const isAdmin = normalizedRole === 'admin';
  const [isSaleCaptureTrainingPickerOpen, setIsSaleCaptureTrainingPickerOpen] = useState(true);
  const [saleCaptureTrainingSearch, setSaleCaptureTrainingSearch] = useState('');

  // Detail SlideOver State
  const [selectedDeal, setSelectedDeal] = useState<Deal | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);
  const [selectedDealWinDetails, setSelectedDealWinDetails] = useState<DealWinDetailsRecord | null>(null);
  const [loadingSelectedDealWinDetails, setLoadingSelectedDealWinDetails] = useState(false);
  const [isDealWinDetailsModalOpen, setIsDealWinDetailsModalOpen] = useState(false);

  // Multi-Select State
  const [selectedTrainingIds, setSelectedTrainingIds] = useState<string[]>([]);
  const [trainingSearch, setTrainingSearch] = useState('');
  const [showTrainingDropdown, setShowTrainingDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const leadDropdownRef = useRef<HTMLDivElement>(null);
  const saleCaptureTrainingTriggerRef = useRef<HTMLButtonElement>(null);
  const saleCaptureTrainingPanelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (user) {
        fetchDeals();
        fetchTrainings();
        setNewDealOwner(user.id);
    }
  }, [user]);

  useEffect(() => {
    if (users.length === 0) return;
    setDeals((prev) =>
      prev.map((deal) => {
        if (deal.assignee || !deal.owner_id) return deal;
        const fallbackAssignee = users.find((u) => u.id === deal.owner_id);
        if (!fallbackAssignee) return deal;
        return {
          ...deal,
          assignee: fallbackAssignee,
          owner: fallbackAssignee.full_name || deal.owner,
        };
      }),
    );
  }, [users]);

  useEffect(() => {
    if (!selectedDeal || selectedDeal.stage !== 'won') {
      setSelectedDealWinDetails(null);
      setLoadingSelectedDealWinDetails(false);
      return;
    }

    let mounted = true;
    setLoadingSelectedDealWinDetails(true);
    void (async () => {
      const { data, error } = await supabase
        .from('deal_win_details')
        .select('*')
        .eq('deal_id', selectedDeal.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!mounted) return;
      if (error) {
        setSelectedDealWinDetails(null);
      } else {
        setSelectedDealWinDetails((data as DealWinDetailsRecord | null) ?? null);
      }
      setLoadingSelectedDealWinDetails(false);
    })();

    return () => {
      mounted = false;
    };
  }, [selectedDeal]);

  // Click outside listener for dropdown
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowTrainingDropdown(false);
      }
      if (leadDropdownRef.current && !leadDropdownRef.current.contains(event.target as Node)) {
        setShowLeadDropdown(false);
      }
      const saleCaptureClickInsideTrigger =
        !!saleCaptureTrainingTriggerRef.current &&
        saleCaptureTrainingTriggerRef.current.contains(event.target as Node);
      const saleCaptureClickInsidePanel =
        !!saleCaptureTrainingPanelRef.current &&
        saleCaptureTrainingPanelRef.current.contains(event.target as Node);
      if (!saleCaptureClickInsideTrigger && !saleCaptureClickInsidePanel) {
        setIsSaleCaptureTrainingPickerOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const fetchLeadOptions = async () => {
    if (!user) return;

    let query: any = supabase
      .from('leads')
      .select('id,name,user_id,first_name,last_name,email,phone,profession,location,address,client_reference,secure_info,profiles:user_id ( team_id )')
      .order('created_at', { ascending: false })
      .limit(400);

    if (selectedUserId !== 'all') query = query.eq('user_id', selectedUserId);
    if (selectedTeamId !== 'all') query = query.eq('profiles.team_id', selectedTeamId);

    const { data, error } = await query;
    if (error) {
      addNotification('error', `Chargement leads impossible: ${error.message}`);
      return;
    }

    const mapped = ((data ?? []) as any[]).map((row) => ({
      id: row.id,
      name: row.name || 'Lead sans nom',
      user_id: row.user_id ?? null,
      first_name: row.first_name ?? null,
      last_name: row.last_name ?? null,
      email: row.email ?? null,
      phone: row.phone ?? null,
      profession: row.profession ?? null,
      location: row.location ?? null,
      address: row.address ?? null,
      client_reference: row.client_reference ?? null,
      secure_info: row.secure_info ?? null,
    })) as LeadOption[];

    setLeadOptions(mapped);
  };

  const openCreateDealPanel = () => {
    setIsModalOpen(true);
    setNewDealTitle('');
    setNewDealAmount(0);
    setSelectedTrainingIds([]);
    setTrainingSearch('');
    setShowTrainingDropdown(false);
    setNewDealLeadId('');
    setLeadSearch('');
    setShowLeadDropdown(false);
    setOpportunityLeadDraft(buildEmptyOpportunityLeadDraft());
    void fetchLeadOptions();
  };

  const handleSelectDeal = (deal: Deal) => {
      setSelectedDeal(deal);
      // Initialize with data from the list
      const initialIds = deal.trainings?.map(t => t.id).filter(Boolean) || [];
      setSelectedTrainingIds(initialIds);
      setNewDealAmount(deal.amount); 
  };

  const mergeDealsById = (base: Deal[], incoming: Deal[]) => {
    const map = new Map<string, Deal>();
    base.forEach((item) => map.set(item.id, item));
    incoming.forEach((item) => map.set(item.id, item));
    return Array.from(map.values());
  };

  const mapDealRows = (rows: any[]): Deal[] =>
    (rows || []).map((d: any) => {
      const ownerRelation = Array.isArray(d.owner) ? d.owner[0] : d.owner;
      const fallbackAssignee = users.find((u) => u.id === d.owner_id);
      const assignee = ownerRelation || fallbackAssignee;

      return {
        id: d.id,
        leadName: d.title,
        training: d.training,
        amount: d.amount,
        stage: d.stage as Deal['stage'],
        probability: d.probability,
        lead_id: d.lead_id || undefined,
        owner: assignee?.full_name || 'Inconnu',
        owner_id: d.owner_id,
        assignee,
        trainings: d.deal_trainings?.map((dt: any) => dt.training).filter(Boolean) || []
      };
    });

  const fetchDeals = async () => {
    perfStart('pipeline.fetchDeals');
    setLoading(true);
    setErrorState(false);
    const compatKey = `pipeline:compat:${user?.id ?? 'anon'}`;
    const isCompatMode = getCached<boolean>(compatKey, PIPELINE_COMPAT_CACHE_TTL_MS) === true;
    const cacheKey = `pipeline:deals:${user?.id ?? 'anon'}`;
    const cached = getCached<Deal[]>(cacheKey, DEALS_CACHE_TTL_MS);
    if (cached) {
      setDeals(cached);
      setLoading(false);
    }
    try {
        if (isCompatMode) {
            throw new Error("PIPELINE_COMPAT_MODE");
        }
        const allRows: any[] = [];
        let cursor: string | null = null;
        let reachedEnd = false;
        let firstChunk = true;

        while (!reachedEnd && allRows.length < PIPELINE_MAX_ROWS) {
            let query = supabase
                .from('deals')
                .select(`
                    id,title,training,amount,stage,probability,owner_id,lead_id,created_at,
                    owner:owner_id ( id, full_name, avatar_url, team_id ),
                    deal_trainings (
                        training:trainings (id, title, price)
                    )
                `)
                .order('created_at', { ascending: false })
                .limit(PIPELINE_PAGE_SIZE);

            if (cursor) {
                query = query.lt('created_at', cursor);
            }

            const { data, error } = await query;
            if (error) throw error;

            const page = data || [];
            if (page.length === 0) {
                reachedEnd = true;
                break;
            }

            allRows.push(...page);
            const mappedPage = mapDealRows(page);
            cursor = page[page.length - 1]?.created_at ?? null;

            if (firstChunk) {
                setDeals(mappedPage);
                setLoading(false);
                firstChunk = false;
            } else {
                setDeals(prev => mergeDealsById(prev, mappedPage));
            }

            if (page.length < PIPELINE_PAGE_SIZE || !cursor) {
                reachedEnd = true;
            }
        }

        const mappedDeals = mapDealRows(allRows);
        setCached(cacheKey, mappedDeals);
        invalidateCached(compatKey);
        setCompatibilityMode(false);
        setCompatibilityError('');

    } catch (error: any) {
        if (error.message !== "PIPELINE_COMPAT_MODE") {
            console.warn("Pipeline: Mode compatibilité activé. Raison:", error.message);
            const isSchemaMismatch =
              error?.code === '42703' ||
              String(error?.message || '').toLowerCase().includes('schema cache') ||
              String(error?.message || '').toLowerCase().includes('column');
            if (isSchemaMismatch) {
              setCached(compatKey, true);
            }
            setCompatibilityError(error.message);
        } else {
            setCompatibilityError("Mode compatibilité local (fallback rapide).");
        }
        
        try {
            const { data: legacyData, error: legacyError } = await supabase
                .from('deals')
                .select('*')
                .order('created_at', { ascending: false })
                .limit(PIPELINE_PAGE_SIZE * 2);
            
            if (legacyError) throw legacyError;

            const legacyDeals: Deal[] = (legacyData || []).map((d: any) => ({
                id: d.id,
                leadName: d.title,
                training: d.training,
                amount: d.amount,
                stage: d.stage as Deal['stage'],
                probability: d.probability || 20,
                lead_id: d.lead_id || undefined,
                owner: 'Non assigné',
                owner_id: undefined,
                assignee: undefined,
                trainings: []
            }));

            setDeals(legacyDeals);
            setCached(cacheKey, legacyDeals);
            setCompatibilityMode(true);
            
        } catch (finalError: any) {
            console.error("Critical Pipeline Error:", finalError);
            setErrorState(true);
            addNotification('error', "Impossible de charger les données.");
        }
    } finally {
        setLoading(false);
        perfEnd('pipeline.fetchDeals');
    }
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
          .select('id,title,price,organization')
          .order('created_at', { ascending: false })
          .limit(300);
      if (data) {
          setTrainings(data as Training[]);
          setCached(cacheKey, data as Training[]);
      }
  };

  const toggleTrainingSelection = (trainingId: string) => {
      let newIds: string[] = [];
      if (selectedTrainingIds.includes(trainingId)) {
          newIds = selectedTrainingIds.filter(id => id !== trainingId);
      } else {
          newIds = [...selectedTrainingIds, trainingId];
      }
      setSelectedTrainingIds(newIds);

      const sum = trainings
        .filter(t => newIds.includes(t.id))
        .reduce((acc, t) => acc + t.price, 0);
      setNewDealAmount(sum);
  };

  const openSaleCaptureModal = (mode: SaleCaptureMode, deal: Deal | null = null, leadId: string | null = null) => {
    const prefilledTrainingIds = deal?.trainings?.map((t) => t.id).filter(Boolean) || [];
    const prefilledOwnerId = deal?.owner_id || user?.id || '';

    setSaleCaptureMode(mode);
    setSaleCaptureDeal(deal);
    setSaleCaptureLeadId(leadId || deal?.lead_id || null);
    setSaleCaptureForm({
      ...buildEmptySaleCaptureForm(),
      client_name: deal?.leadName || '',
      owner_id: prefilledOwnerId,
      training_ids: prefilledTrainingIds,
      amount: deal?.amount || 0,
    });
    setSaleCaptureAssetBaseline(buildEmptySaleCaptureAssetBaseline());
    setIsSaleCaptureTrainingPickerOpen(prefilledTrainingIds.length === 0);
    setIsSaleCaptureModalOpen(true);
  };

  const isDealOwner = (deal: Deal | null) => {
    if (!deal || !user?.id) return false;
    return !!deal.owner_id && deal.owner_id === user.id;
  };

  const canEditConfirmedSale = !!selectedDeal && (isAdmin || isDealOwner(selectedDeal));
  const isEditingExistingWonSale = saleCaptureMode === 'existing_deal' && !!saleCaptureDeal && saleCaptureDeal.stage === 'won';
  const isOwnerNonAdminEditingWonSale = isEditingExistingWonSale && !isAdmin && !!saleCaptureDeal && isDealOwner(saleCaptureDeal);

  const openEditConfirmedSale = async () => {
    if (!selectedDeal || selectedDeal.stage !== 'won') return;
    if (!canEditConfirmedSale) {
      addNotification('error', 'Modification réservée au propriétaire de la vente ou à un admin.');
      return;
    }

    openSaleCaptureModal('existing_deal', selectedDeal, selectedDeal.lead_id || null);

    const { data, error } = await supabase
      .from('deal_win_details')
      .select('*')
      .eq('deal_id', selectedDeal.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !data) return;
    const details = data as DealWinDetailsRecord;
    setSaleCaptureForm((prev) => ({
      ...prev,
      session_label: details.session_label || '',
      first_connection_date: details.first_connection_date || '',
      first_connection_time: details.first_connection_time || '',
      first_connection_done: !!details.first_connection_done,
      recording_1_url: details.recording_1_url || '',
      recording_1_file_ref: details.recording_1_file_ref || '',
      recording_2_url: details.recording_2_url || '',
      recording_2_file_ref: details.recording_2_file_ref || '',
      proof_url: details.proof_url || '',
      proof_file_ref: details.proof_file_ref || '',
      sale_comment: details.sale_comment || '',
      followup_comment: details.followup_comment || '',
      organization_comment: details.organization_comment || '',
      unsubscription_comment: details.unsubscription_comment || '',
    }));
    setSaleCaptureAssetBaseline({
      recording_1_url: details.recording_1_url || '',
      recording_1_file_ref: details.recording_1_file_ref || '',
      recording_2_url: details.recording_2_url || '',
      recording_2_file_ref: details.recording_2_file_ref || '',
      proof_url: details.proof_url || '',
      proof_file_ref: details.proof_file_ref || '',
    });
  };

  const uploadSaleAsset = async (file: File, slot: 'recording_1' | 'recording_2' | 'proof') => {
    if (!user) return;
    if (isEditingExistingWonSale && saleCaptureDeal && !(isAdmin || isDealOwner(saleCaptureDeal))) {
      addNotification('error', 'Upload réservé au propriétaire de la vente ou à un admin.');
      return;
    }
    setIsUploadingSaleAsset(true);
    try {
      const extension = file.name.includes('.') ? file.name.split('.').pop() : 'bin';
      const safeExt = extension ? extension.toLowerCase() : 'bin';
      const objectPath = `${user.id}/${Date.now()}-${slot}.${safeExt}`;
      const { error: uploadError } = await supabase.storage
        .from('sale-assets')
        .upload(objectPath, file, { upsert: false, cacheControl: '3600' });

      if (uploadError) {
        addNotification('error', `Upload impossible: ${uploadError.message}`);
        return;
      }

      const { data } = supabase.storage.from('sale-assets').getPublicUrl(objectPath);
      const publicUrl = data?.publicUrl || '';

      setSaleCaptureForm((prev) => {
        if (slot === 'recording_1') {
          return { ...prev, recording_1_url: publicUrl, recording_1_file_ref: objectPath };
        }
        if (slot === 'recording_2') {
          return { ...prev, recording_2_url: publicUrl, recording_2_file_ref: objectPath };
        }
        return { ...prev, proof_url: publicUrl, proof_file_ref: objectPath };
      });

      addNotification('success', 'Fichier téléversé.');
    } finally {
      setIsUploadingSaleAsset(false);
    }
  };

  const getTrainingTitles = (trainingIds: string[]) =>
    trainings
      .filter((t) => trainingIds.includes(t.id))
      .map((t) => t.title)
      .join(', ');

  const getTrainingTitleList = (trainingIds: string[]) =>
    trainings
      .filter((t) => trainingIds.includes(t.id))
      .map((t) => t.title)
      .filter(Boolean);

  const getTrainingWithOrganizationList = (trainingIds: string[]) =>
    trainings
      .filter((t) => trainingIds.includes(t.id))
      .map((t) => ({
        title: t.title,
        organization: t.organization || null,
      }))
      .filter((t) => !!t.title);

  const toggleSaleCaptureTraining = (trainingId: string) => {
    setSaleCaptureForm((prev) => {
      const exists = prev.training_ids.includes(trainingId);
      const nextIds = exists ? prev.training_ids.filter((id) => id !== trainingId) : [...prev.training_ids, trainingId];
      const nextAmount = trainings
        .filter((t) => nextIds.includes(t.id))
        .reduce((sum, t) => sum + t.price, 0);
      return { ...prev, training_ids: nextIds, amount: nextAmount };
    });
  };

  const saveDealWinDetails = async (dealId: string, form: SaleCaptureForm, actorId: string) => {
    const payload = {
      deal_id: dealId,
      session_label: form.session_label || null,
      first_connection_date: form.first_connection_date || null,
      first_connection_time: form.first_connection_time || null,
      first_connection_done: form.first_connection_done,
      recording_1_url: form.recording_1_url || null,
      recording_1_file_ref: form.recording_1_file_ref || null,
      recording_2_url: form.recording_2_url || null,
      recording_2_file_ref: form.recording_2_file_ref || null,
      proof_url: form.proof_url || null,
      proof_file_ref: form.proof_file_ref || null,
      sale_comment: form.sale_comment || null,
      followup_comment: form.followup_comment || null,
      organization_comment: form.organization_comment || null,
      unsubscription_comment: form.unsubscription_comment || null,
      created_by: actorId,
    };
    const { data: latest, error: latestError } = await supabase
      .from('deal_win_details')
      .select('id')
      .eq('deal_id', dealId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (latestError) return latestError;

    if (latest?.id) {
      const { error } = await supabase.from('deal_win_details').update(payload).eq('id', latest.id);
      return error;
    }

    const { error } = await supabase.from('deal_win_details').insert(payload);
    return error;
  };

  const createDeal = async () => {
    if(!user || !newDealTitle) return;

    const trainingTitles = trainings
        .filter(t => selectedTrainingIds.includes(t.id))
        .map(t => t.title).join(', ');

    let ensuredLeadId: string | null = newDealLeadId || null;
    if (!ensuredLeadId) {
      const firstName = opportunityLeadDraft.first_name.trim() || newDealTitle.trim().split(/\s+/).filter(Boolean)[0] || newDealTitle.trim();
      const lastName = opportunityLeadDraft.last_name.trim() || null;
      const normalizedDisplayName = `${firstName} ${lastName || ''}`.trim() || newDealTitle.trim();
      const { data: newLeadData, error: newLeadError } = await supabase
        .from('leads')
        .insert([{
          user_id: newDealOwner || user.id,
          name: normalizedDisplayName,
          first_name: firstName,
          last_name: lastName,
          profession: opportunityLeadDraft.profession.trim() || null,
          email: opportunityLeadDraft.email.trim() || null,
          phone: opportunityLeadDraft.phone.trim() || null,
          address: opportunityLeadDraft.address.trim() || null,
          client_reference: opportunityLeadDraft.client_reference.trim() || null,
          secure_info: opportunityLeadDraft.secure_info.trim() || null,
          location: opportunityLeadDraft.location.trim() || null,
          status: 'new',
          is_pipeline: true,
          last_activity: new Date().toISOString(),
        }])
        .select('id')
        .single();
      if (newLeadError || !newLeadData?.id) {
        addNotification('error', `Impossible de créer le lead lié: ${newLeadError?.message || 'erreur inconnue'}`);
        return;
      }
      ensuredLeadId = newLeadData.id;
    } else {
      const leadUpdatePayload: Record<string, string> = {};
      if (opportunityLeadDraft.first_name.trim()) leadUpdatePayload.first_name = opportunityLeadDraft.first_name.trim();
      if (opportunityLeadDraft.last_name.trim()) leadUpdatePayload.last_name = opportunityLeadDraft.last_name.trim();
      if (opportunityLeadDraft.profession.trim()) leadUpdatePayload.profession = opportunityLeadDraft.profession.trim();
      if (opportunityLeadDraft.email.trim()) leadUpdatePayload.email = opportunityLeadDraft.email.trim();
      if (opportunityLeadDraft.phone.trim()) leadUpdatePayload.phone = opportunityLeadDraft.phone.trim();
      if (opportunityLeadDraft.address.trim()) leadUpdatePayload.address = opportunityLeadDraft.address.trim();
      if (opportunityLeadDraft.client_reference.trim()) leadUpdatePayload.client_reference = opportunityLeadDraft.client_reference.trim();
      if (opportunityLeadDraft.secure_info.trim()) leadUpdatePayload.secure_info = opportunityLeadDraft.secure_info.trim();
      if (opportunityLeadDraft.location.trim()) leadUpdatePayload.location = opportunityLeadDraft.location.trim();

      if (Object.keys(leadUpdatePayload).length > 0) {
        const fullName = `${leadUpdatePayload.first_name || ''} ${leadUpdatePayload.last_name || ''}`.trim();
        if (fullName) {
          leadUpdatePayload.name = fullName;
        }
        await supabase
          .from('leads')
          .update({ ...leadUpdatePayload, last_activity: new Date().toISOString() })
          .eq('id', ensuredLeadId);
      }
    }

    const payload: any = {
        title: newDealTitle,
        training: trainingTitles,
        amount: newDealAmount,
        stage: 'new',
        probability: 20,
        lead_id: ensuredLeadId,
    };

    if (!compatibilityMode) {
        payload.owner_id = newDealOwner || user.id;
    }

    const primaryInsert = await supabase.from('deals').insert([payload]).select().single();
    let dealData = primaryInsert.data;
    let error = primaryInsert.error;
    if (error && (error.code === '42703' || String(error.message || '').toLowerCase().includes('lead_id'))) {
      const fallbackPayload = { ...payload };
      delete fallbackPayload.lead_id;
      const fallbackInsert = await supabase.from('deals').insert([fallbackPayload]).select().single();
      dealData = fallbackInsert.data;
      error = fallbackInsert.error;
    }

    if (!error && dealData) {
        if (selectedTrainingIds.length > 0 && !compatibilityMode) {
            const relations = selectedTrainingIds.map(tId => ({
                deal_id: dealData.id,
                training_id: tId
            }));
            const { error: relationInsertError } = await supabase.from('deal_trainings').insert(relations);
            if (relationInsertError) {
                console.warn("Relation insert failed", relationInsertError);
            }
        }
        invalidateCached('pipeline:deals:');
        fetchDeals();
        setIsModalOpen(false);
        setOpportunityLeadDraft(buildEmptyOpportunityLeadDraft());
        addNotification('success', 'Opportunité créée avec succès');
        
        // Notify Managers
        if (profile) {
            pushAppNotification(
                'Nouvelle Opportunité',
                `${profile.full_name} a créé une opportunité: ${newDealTitle} (${newDealAmount}€).`,
                'info'
            );
        }

    } else {
        addNotification('error', error?.message || 'Erreur');
    }
  };

  const handleCreateDealLeadLink = async (leadId: string) => {
    setNewDealLeadId(leadId);
    const linkedLead = leadOptions.find((lead) => lead.id === leadId);
    if (!linkedLead) return;

    setLeadSearch(linkedLead.name);
    setShowLeadDropdown(false);
    setNewDealTitle(linkedLead.name);
    setOpportunityLeadDraft({
      first_name: linkedLead.first_name || '',
      last_name: linkedLead.last_name || '',
      profession: linkedLead.profession || '',
      email: linkedLead.email || '',
      phone: linkedLead.phone || '',
      location: linkedLead.location || '',
      address: linkedLead.address || '',
      client_reference: linkedLead.client_reference || '',
      secure_info: linkedLead.secure_info || '',
    });
    if (!compatibilityMode && linkedLead.user_id) {
      setNewDealOwner(linkedLead.user_id);
    }

    try {
      const { data, error } = await supabase
        .from('lead_trainings')
        .select('training_id')
        .eq('lead_id', leadId);

      if (error) {
        setSelectedTrainingIds([]);
        setNewDealAmount(0);
        return;
      }

      const linkedTrainingIds = ((data ?? []) as Array<{ training_id: string }>).map((item) => item.training_id);
      setSelectedTrainingIds(linkedTrainingIds);
      const amount = trainings
        .filter((training) => linkedTrainingIds.includes(training.id))
        .reduce((sum, training) => sum + training.price, 0);
      setNewDealAmount(amount);
    } catch {
      setSelectedTrainingIds([]);
      setNewDealAmount(0);
    }
  };

  const filteredLeadOptions = leadOptions.filter((lead) => {
    const keyword = leadSearch.trim().toLowerCase();
    if (!keyword) return true;
    return (
      lead.name.toLowerCase().includes(keyword) ||
      (lead.profession ?? '').toLowerCase().includes(keyword) ||
      (lead.location ?? '').toLowerCase().includes(keyword) ||
      (lead.email ?? '').toLowerCase().includes(keyword)
    );
  });

  const handleUpdateDeal = async () => {
    if (!selectedDeal) return;
    setIsUpdating(true);
    try {
        const updates: any = {
            amount: newDealAmount, 
            probability: selectedDeal.probability,
            stage: selectedDeal.stage,
            title: selectedDeal.leadName,
        };

        if (!compatibilityMode) {
            updates.owner_id = selectedDeal.owner_id;
        }

        const { error: updateError } = await supabase
            .from('deals')
            .update(updates)
            .eq('id', selectedDeal.id);

        if (updateError) throw updateError;

        if (!compatibilityMode) {
            const { error: relationDeleteError } = await supabase.from('deal_trainings').delete().eq('deal_id', selectedDeal.id);
            if (relationDeleteError) {
                console.warn("Relation delete failed", relationDeleteError);
            }
            if (selectedTrainingIds.length > 0) {
                const relations = selectedTrainingIds.map(tId => ({
                    deal_id: selectedDeal.id,
                    training_id: tId
                }));
                await supabase.from('deal_trainings').insert(relations);
            }
        }

        const updatedTrainings = trainings.filter(t => selectedTrainingIds.includes(t.id));
        const updatedDeal = {
            ...selectedDeal,
            amount: newDealAmount,
            trainings: updatedTrainings
        };

        setDeals(prev => prev.map(d => d.id === selectedDeal.id ? updatedDeal : d));
        invalidateCached('pipeline:deals:');
        setSelectedDeal(updatedDeal);
        addNotification('success', 'Opportunité mise à jour');
    } catch (error: any) {
        addNotification('error', error.message);
    } finally {
        setIsUpdating(false);
    }
  };

  const handleDeleteDeal = async () => {
    if (!selectedDeal) return;
    if (!window.confirm(`Supprimer définitivement l'opportunité "${selectedDeal.leadName}" ?`)) return;

    try {
      if (!compatibilityMode) {
        await supabase.from('deal_trainings').delete().eq('deal_id', selectedDeal.id);
      }
      const { error } = await supabase.from('deals').delete().eq('id', selectedDeal.id);
      if (error) throw error;

      setDeals((prev) => prev.filter((deal) => deal.id !== selectedDeal.id));
      invalidateCached('pipeline:deals:');
      setSelectedDeal(null);
      addNotification('success', 'Opportunité supprimée.');
    } catch (error: any) {
      addNotification('error', error?.message || 'Suppression impossible.');
    }
  };

  const filteredDeals = deals.filter(deal => {
      if (compatibilityMode) return true;
      const matchesUser = selectedUserId === 'all' || deal.owner_id === selectedUserId;
      const matchesTeam = selectedTeamId === 'all' || deal.assignee?.team_id === selectedTeamId;
      return matchesUser && matchesTeam;
  });

  const getDealsByStage = (stage: Deal['stage']) => filteredDeals.filter(d => d.stage === stage);
  const getTotal = (stageDeals: Deal[]) => stageDeals.reduce((acc, curr) => acc + toWholeEuro(curr.amount), 0);

  const handleDragStart = (e: React.DragEvent, id: string) => {
    e.dataTransfer.setData("dealId", id);
    e.dataTransfer.effectAllowed = "move";
  };
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };
  
  const handleDrop = async (e: React.DragEvent, newStage: Deal['stage']) => {
    e.preventDefault();
    const dealId = e.dataTransfer.getData("dealId");
    const deal = deals.find(d => d.id === dealId);
    
    if (!deal) return;
    const previousStage = deal.stage;

    if (newStage === 'won' && previousStage !== 'won') {
        openSaleCaptureModal('existing_deal', deal, deal.lead_id || null);
        return;
    }

    if (newStage === previousStage) return;

    await updateDealStage(dealId, newStage);

    // Smart trigger: opening task modal contextually after a stage move.
    const params = new URLSearchParams(window.location.search);
    params.set('action', 'create-task');
    params.set('leadId', deal.lead_id || '');
    params.set('stage', newStage);
    window.history.replaceState({}, '', `${window.location.pathname}?${params.toString()}`);
  };

  const updateDealStage = async (dealId: string, newStage: Deal['stage']) => {
    let newProb = 20;
    if (newStage === 'new') newProb = 20;
    if (newStage === 'negotiation') newProb = 50;
    if (newStage === 'closing') newProb = 80;
    if (newStage === 'won') newProb = 100;

    setDeals(prevDeals => prevDeals.map(deal => {
      if (deal.id === dealId) {
        return { ...deal, stage: newStage, probability: newProb };
      }
      return deal;
    }));

    const { error } = await supabase.from('deals').update({ stage: newStage, probability: newProb }).eq('id', dealId);
    if (error) {
        fetchDeals(); // Revert
        addNotification('error', 'Erreur lors du déplacement');
    } else {
        invalidateCached('pipeline:deals:');
    }
  };

  const handleConfirmWin = async () => {
      setIsWonModalOpen(false);
      setWonDealSummary(null);
  };

  const handleConfirmSaleCapture = async () => {
    if (!user) return;
    if (isEditingExistingWonSale && saleCaptureDeal && !(isAdmin || isDealOwner(saleCaptureDeal))) {
      addNotification('error', 'Modification réservée au propriétaire de la vente ou à un admin.');
      return;
    }
    if (isOwnerNonAdminEditingWonSale) {
      const protectedKeys: Array<keyof SaleCaptureAssetBaseline> = [
        'recording_1_url',
        'recording_1_file_ref',
        'recording_2_url',
        'recording_2_file_ref',
        'proof_url',
        'proof_file_ref',
      ];
      const triesToDeleteExistingAsset = protectedKeys.some((key) => {
        const baselineValue = (saleCaptureAssetBaseline[key] ?? '').trim();
        const currentValue = (saleCaptureForm[key] ?? '').trim();
        return baselineValue.length > 0 && currentValue.length === 0;
      });
      if (triesToDeleteExistingAsset) {
        addNotification('error', 'Seul un admin peut supprimer un fichier déjà téléversé.');
        return;
      }
    }

    if (!saleCaptureForm.client_name.trim()) {
      addNotification('error', 'Le client est obligatoire.');
      return;
    }
    if (!saleCaptureForm.owner_id.trim()) {
      addNotification('error', 'Le commercial est obligatoire.');
      return;
    }
    if (saleCaptureForm.training_ids.length === 0) {
      addNotification('error', 'Au moins une formation est obligatoire.');
      return;
    }
    if (!Number.isFinite(saleCaptureForm.amount) || saleCaptureForm.amount <= 0) {
      addNotification('error', 'Le montant doit être supérieur à 0.');
      return;
    }
    if (!saleCaptureForm.proof_url.trim()) {
      addNotification('error', 'Le screen preuve URL est obligatoire.');
      return;
    }

    setIsSavingSaleCapture(true);
    let targetDealId: string | null = saleCaptureDeal?.id || null;
    const targetLeadName = saleCaptureForm.client_name.trim();
    const targetAmount = Number(saleCaptureForm.amount);

    try {
      const trainingTitles = getTrainingTitles(saleCaptureForm.training_ids);

      if (saleCaptureMode === 'existing_deal' && saleCaptureDeal) {
        const { error: updateError } = await supabase
          .from('deals')
          .update({
            title: targetLeadName,
            amount: targetAmount,
            training: trainingTitles,
            owner_id: compatibilityMode ? saleCaptureDeal.owner_id : saleCaptureForm.owner_id,
            stage: 'won',
            probability: 100,
            closed_at: new Date().toISOString(),
            lead_id: saleCaptureLeadId,
          })
          .eq('id', saleCaptureDeal.id);
        if (updateError && !(updateError.code === '42703' || String(updateError.message || '').toLowerCase().includes('lead_id'))) {
          throw updateError;
        }
        targetDealId = saleCaptureDeal.id;

        if (!compatibilityMode) {
          await supabase.from('deal_trainings').delete().eq('deal_id', saleCaptureDeal.id);
          const relations = saleCaptureForm.training_ids.map((trainingId) => ({
            deal_id: saleCaptureDeal.id,
            training_id: trainingId,
          }));
          if (relations.length > 0) {
            const { error: relationsError } = await supabase.from('deal_trainings').insert(relations);
            if (relationsError) {
              console.warn('Relation update failed:', relationsError.message);
            }
          }
        }
      } else {
        let ensuredLeadId = saleCaptureLeadId;
        if (!ensuredLeadId) {
          const nameParts = targetLeadName.split(/\s+/).filter(Boolean);
          const firstName = nameParts[0] || targetLeadName;
          const lastName = nameParts.slice(1).join(' ') || null;
          const { data: createdLead, error: createdLeadError } = await supabase
            .from('leads')
            .insert([{
              user_id: saleCaptureForm.owner_id,
              name: targetLeadName,
              first_name: firstName,
              last_name: lastName,
              status: 'new',
              is_pipeline: true,
              last_activity: new Date().toISOString(),
            }])
            .select('id')
            .single();
          if (createdLeadError || !createdLead?.id) {
            throw createdLeadError || new Error('Impossible de créer le lead lié');
          }
          ensuredLeadId = createdLead.id;
          setSaleCaptureLeadId(ensuredLeadId);
        }

        const createPayload: any = {
          title: targetLeadName,
          training: trainingTitles,
          amount: targetAmount,
          stage: 'won',
          probability: 100,
          closed_at: new Date().toISOString(),
          lead_id: ensuredLeadId,
        };
        if (!compatibilityMode) {
          createPayload.owner_id = saleCaptureForm.owner_id;
        }

        let createdDeal: { id: string } | null = null;
        let createError: any = null;
        const primaryCreate = await supabase.from('deals').insert([createPayload]).select('id').single();
        createdDeal = primaryCreate.data;
        createError = primaryCreate.error;
        if (createError && (createError.code === '42703' || String(createError.message || '').toLowerCase().includes('lead_id'))) {
          const fallbackPayload = { ...createPayload };
          delete fallbackPayload.lead_id;
          const fallbackCreate = await supabase.from('deals').insert([fallbackPayload]).select('id').single();
          createdDeal = fallbackCreate.data;
          createError = fallbackCreate.error;
        }
        if (createError || !createdDeal) throw createError || new Error('Creation de vente impossible');
        targetDealId = createdDeal.id;

        if (!compatibilityMode) {
          const relations = saleCaptureForm.training_ids.map((trainingId) => ({
            deal_id: createdDeal.id,
            training_id: trainingId,
          }));
          if (relations.length > 0) {
            const { error: relationsError } = await supabase.from('deal_trainings').insert(relations);
            if (relationsError) {
              console.warn('Relation insert failed:', relationsError.message);
            }
          }
        }
      }

      if (targetDealId) {
        const detailsError = await saveDealWinDetails(targetDealId, saleCaptureForm, user.id);
        if (detailsError) {
          console.warn('deal_win_details insert failed:', detailsError.message);
        }
      }

      if (saleCaptureLeadId) {
        const { error: leadStatusError } = await supabase
          .from('leads')
          .update({ status: 'won', last_activity: new Date().toISOString(), is_pipeline: true })
          .eq('id', saleCaptureLeadId);
        if (leadStatusError) {
          console.warn('Lead status update failed:', leadStatusError.message);
        }
      }

      const ownerProfile = users.find((u) => u.id === saleCaptureForm.owner_id);
      const salesPersonName = ownerProfile?.full_name || profile?.full_name || 'Un commercial';

      const { error: allHandsError } = await supabase.rpc('publish_sale_announcement_to_all_chat', {
        p_lead_name: targetLeadName,
        p_amount: targetAmount,
        p_currency: 'EUR',
      });

      if (allHandsError) {
        console.error('[Chat @all] publication erreur:', allHandsError.message);
      }

      pushAppNotification(
        'Vente Confirmée !',
        `${salesPersonName} a signé ${targetLeadName} pour ${targetAmount}€ !`,
        'success'
      );

      invalidateCached('pipeline:deals:');
      await fetchDeals();

      setIsSaleCaptureModalOpen(false);
      setSaleCaptureDeal(null);
      setSaleCaptureLeadId(null);
      setSaleCaptureAssetBaseline(buildEmptySaleCaptureAssetBaseline());
      setWonDealSummary({ leadName: targetLeadName, amount: targetAmount });
      setIsWonModalOpen(true);

      if (allHandsError) {
        addNotification('warning', 'Vente enregistrée, mais publication chat @all indisponible.');
      } else {
        addNotification('success', 'Vente enregistrée et annoncée dans @all.');
      }
    } catch (error: any) {
      addNotification('error', error?.message || 'Impossible d’enregistrer la vente.');
    } finally {
      setIsSavingSaleCapture(false);
    }
  };

  useEffect(() => {
    if (saleCaptureUrlHandled || !user) return;
    const params = new URLSearchParams(window.location.search);
    const action = params.get('action');
    if (action !== 'capture-sale') return;

    const dealId = params.get('dealId');
    const leadId = params.get('leadId');
    if (!dealId) return;

    const launch = async () => {
      const inMemoryDeal = deals.find((d) => d.id === dealId);
      if (inMemoryDeal) {
        openSaleCaptureModal('existing_deal', inMemoryDeal, leadId);
      } else {
        const { data, error } = await supabase
          .from('deals')
          .select('id,title,amount,stage,probability,owner_id,lead_id,training')
          .eq('id', dealId)
          .single();
        if (!error && data) {
          openSaleCaptureModal(
            'existing_deal',
            {
              id: data.id,
              leadName: data.title,
              training: data.training || '',
              trainings: [],
              amount: Number(data.amount || 0),
              stage: data.stage as Deal['stage'],
              probability: Number(data.probability || 100),
              lead_id: data.lead_id || undefined,
              owner: 'Assigné',
              owner_id: data.owner_id || undefined,
              assignee: undefined,
            },
            leadId || data.lead_id || null,
          );
        }
      }

      params.delete('action');
      params.delete('dealId');
      params.delete('leadId');
      const nextQs = params.toString();
      window.history.replaceState({}, '', `${window.location.pathname}${nextQs ? `?${nextQs}` : ''}`);
      setSaleCaptureUrlHandled(true);
    };

    void launch();
  }, [saleCaptureUrlHandled, user, deals]);

  const renderMultiSelect = () => (
     <div className="relative" ref={dropdownRef}>
        <label className="ui-field-label">Formations associées</label>
        <div className="flex flex-wrap gap-2 mb-2">
            {selectedTrainingIds.map(id => {
                let t = trainings.find(tr => tr.id === id);
                if (!t && selectedDeal && selectedDeal.trainings) t = selectedDeal.trainings.find(tr => tr.id === id);
                return t ? (<span key={id} className="inline-flex items-center gap-1 px-2 py-1 rounded bg-gray-100 border border-gray-200 text-xs font-medium text-primary">{t.title}<button onClick={() => toggleTrainingSelection(id)} className="hover:text-red-500"><X size={12} /></button></span>) : null;
            })}
        </div>
        <div className="relative">
            <input type="text" placeholder="Rechercher une formation..." value={trainingSearch} onChange={(e) => { setTrainingSearch(e.target.value); setShowTrainingDropdown(true); }} onFocus={() => setShowTrainingDropdown(true)} className="ui-input pr-8" />
            <div className="absolute right-2 top-2.5 text-gray-400 pointer-events-none"><Search size={14} /></div>
        </div>
        {showTrainingDropdown && (
            <div className="absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded-md border border-zinc-200 bg-white shadow-card">
                {trainings.filter(t => t.title.toLowerCase().includes(trainingSearch.toLowerCase())).map(t => (
                    <div key={t.id} onClick={() => { toggleTrainingSelection(t.id); setTrainingSearch(''); }} className={`px-3 py-2 text-sm cursor-pointer flex items-center justify-between hover:bg-gray-50 ${selectedTrainingIds.includes(t.id) ? 'bg-zinc-100' : ''}`}>
                        <div><p className="font-medium text-primary">{t.title}</p><p className="text-xs text-secondary">{t.price} €</p></div>
                        {selectedTrainingIds.includes(t.id) && <Check size={14} className="text-zinc-700" />}
                    </div>
                ))}
            </div>
        )}
    </div>
  );

  if (loading) {
    return (
      <SectionLoader className="motion-fade-up h-full p-10 text-sm" />
    );
  }

  return (
    <div className="ui-page h-full flex flex-col">
      <div className="mb-6 flex items-center justify-between motion-fade-up">
         <SectionTitle title="Pipeline" subtitle="Gérez vos opportunités en cours" />
         <div className="flex items-center gap-4">
            <button 
                onClick={() => {
                    openSaleCaptureModal('direct', null);
                }}
                className="ui-btn ui-btn-secondary micro-interaction motion-soft-hover motion-soft-press hidden sm:flex"
            >
                <Award size={16} className="text-zinc-500" /> Ajouter une vente
            </button>

            <button 
                onClick={openCreateDealPanel}
                className="ui-btn ui-btn-primary micro-interaction motion-soft-hover motion-soft-press"
            >
                <Plus size={16} /> <span className="hidden sm:inline">Nouvelle opportunité</span>
            </button>
         </div>
      </div>

      <FilterBar />
      
      {errorState ? (
          <div className="ui-state-box ui-state-error motion-fade-up flex h-64 flex-col items-center justify-center p-8 text-center">
              <AlertCircle className="text-red-400 mb-3" size={32} />
              <p className="ui-state-title">Erreur de chargement</p>
              <p className="ui-state-text mb-4">La structure de la base de données ne correspond pas à la version actuelle de l'application.</p>
          </div>
      ) : (
        <>
            {compatibilityMode && (
                <div className="mb-4 flex items-start justify-between gap-2 rounded border border-zinc-200 bg-zinc-50 p-3 text-xs text-zinc-700 motion-fade-up">
                    <div className="flex gap-2">
                        <AlertCircle size={14} className="shrink-0 mt-0.5 text-zinc-500" /> 
                        <div>
                            <span className="font-semibold block mb-0.5">Mode compatibilité activé</span>
                            <span className="opacity-90">La base de données n'est pas synchronisée avec la V2.</span>
                            {compatibilityError && <div className="mt-1 font-mono text-[10px] bg-zinc-100 p-1 rounded text-zinc-600">{compatibilityError}</div>}
                        </div>
                    </div>
                    <button 
                        onClick={() => fetchDeals()}
                        className="flex items-center gap-1.5 whitespace-nowrap rounded border border-zinc-200 bg-white px-3 py-1 text-xs font-medium text-zinc-700 shadow-sm transition-colors hover:bg-zinc-50 motion-soft-hover motion-soft-press"
                    >
                        <RefreshCw size={12} /> Réessayer
                    </button>
                </div>
            )}
            <div className="grid h-full grid-cols-1 gap-4 pb-6 sm:grid-cols-2 lg:grid-cols-4 lg:gap-3 xl:gap-4 2xl:gap-6">
                {(['new', 'negotiation', 'closing', 'won'] as const).map(stage => (
                    <PipelineColumn 
                        key={stage}
                        title={stage === 'new' ? 'Nouveau' : stage === 'negotiation' ? 'Négociation' : stage === 'closing' ? 'Closing' : 'Gagné'} 
                        stage={stage}
                        deals={getDealsByStage(stage)} 
                        totalValue={getTotal(getDealsByStage(stage))} 
                        onDrop={handleDrop}
                        onDragOver={handleDragOver}
                        onDragStart={handleDragStart}
                        onOpenCreate={openCreateDealPanel}
                        onSelectDeal={handleSelectDeal}
                    />
                ))}
            </div>
        </>
      )}

      {/* CREATE PANEL */}
      <SlideOver isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title="Nouvelle Opportunité" maxWidth="lg">
             <p className="mb-5 text-sm text-secondary">Créez une opportunité en quelques champs clés.</p>
             <div className="space-y-4">
                <div>
                    <label className="ui-field-label">Lier un lead (optionnel)</label>
                    <div className="relative" ref={leadDropdownRef}>
                      <input
                        value={leadSearch}
                        onChange={(e) => {
                          setLeadSearch(e.target.value);
                          setShowLeadDropdown(true);
                          if (!e.target.value.trim()) {
                            setNewDealLeadId('');
                          }
                        }}
                        onFocus={() => setShowLeadDropdown(true)}
                        placeholder="Rechercher un lead..."
                        className="ui-input pr-8"
                      />
                      <div className="pointer-events-none absolute right-2 top-2.5 text-gray-400">
                        <Search size={14} />
                      </div>

                      {showLeadDropdown ? (
                        <div className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-md border border-zinc-200 bg-white shadow-card">
                          <button
                            type="button"
                            onClick={() => {
                              setNewDealLeadId('');
                              setLeadSearch('');
                              setShowLeadDropdown(false);
                              setOpportunityLeadDraft(buildEmptyOpportunityLeadDraft());
                            }}
                            className={`w-full px-3 py-2 text-left text-sm hover:bg-zinc-50 ${newDealLeadId ? '' : 'bg-zinc-100'}`}
                          >
                            Aucun lead lié
                          </button>
                          {filteredLeadOptions.map((lead) => (
                            <button
                              key={lead.id}
                              type="button"
                              onClick={() => void handleCreateDealLeadLink(lead.id)}
                              className={`w-full px-3 py-2 text-left hover:bg-zinc-50 ${newDealLeadId === lead.id ? 'bg-zinc-100' : ''}`}
                            >
                              <p className="truncate text-sm font-medium text-primary">{lead.name}</p>
                              <p className="truncate text-xs text-secondary">
                                {lead.profession || 'Profession non renseignée'}
                                {lead.location ? ` • ${lead.location}` : ''}
                              </p>
                            </button>
                          ))}
                          {filteredLeadOptions.length === 0 ? (
                            <p className="px-3 py-2 text-xs text-secondary">Aucun lead trouvé.</p>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                </div>
                <div>
                    <label className="ui-field-label">Nom du prospect / Deal</label>
                    <input type="text" value={newDealTitle} onChange={(e) => setNewDealTitle(e.target.value)} className="ui-input" placeholder="Ex: Dr. House" />
                </div>

                <div className="rounded-md border border-zinc-200 bg-zinc-50/60 p-3">
                    <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.06em] text-zinc-500">Informations Lead</label>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <input className="ui-input" placeholder="Prénom" value={opportunityLeadDraft.first_name} onChange={(e) => setOpportunityLeadDraft((prev) => ({ ...prev, first_name: e.target.value }))} />
                        <input className="ui-input" placeholder="Nom" value={opportunityLeadDraft.last_name} onChange={(e) => setOpportunityLeadDraft((prev) => ({ ...prev, last_name: e.target.value }))} />
                        <input className="ui-input" placeholder="Profession" value={opportunityLeadDraft.profession} onChange={(e) => setOpportunityLeadDraft((prev) => ({ ...prev, profession: e.target.value }))} />
                        <input className="ui-input" placeholder="Email" value={opportunityLeadDraft.email} onChange={(e) => setOpportunityLeadDraft((prev) => ({ ...prev, email: e.target.value }))} />
                        <input className="ui-input" placeholder="Téléphone" value={opportunityLeadDraft.phone} onChange={(e) => setOpportunityLeadDraft((prev) => ({ ...prev, phone: e.target.value }))} />
                        <input className="ui-input" placeholder="Ville" value={opportunityLeadDraft.location} onChange={(e) => setOpportunityLeadDraft((prev) => ({ ...prev, location: e.target.value }))} />
                        <input className="ui-input" placeholder="Référence client" value={opportunityLeadDraft.client_reference} onChange={(e) => setOpportunityLeadDraft((prev) => ({ ...prev, client_reference: e.target.value }))} />
                        <input className="ui-input" placeholder="Info sécurisée" value={opportunityLeadDraft.secure_info} onChange={(e) => setOpportunityLeadDraft((prev) => ({ ...prev, secure_info: e.target.value }))} />
                        <textarea className="ui-input h-20 resize-none sm:col-span-2" placeholder="Adresse complète" value={opportunityLeadDraft.address} onChange={(e) => setOpportunityLeadDraft((prev) => ({ ...prev, address: e.target.value }))} />
                    </div>
                </div>
                
                {profile?.role !== 'commercial' && !compatibilityMode && (
                    <div>
                        <label className="ui-field-label">Attribuer à</label>
                        <select value={newDealOwner} onChange={(e) => setNewDealOwner(e.target.value)} className="ui-input">
                            <option value="">Moi-même</option>
                            {users.map(u => (<option key={u.id} value={u.id}>{u.full_name || u.email}</option>))}
                        </select>
                    </div>
                )}

                {renderMultiSelect()}
                <div>
                    <label className="ui-field-label">Montant estimé (€)</label>
                    <input type="number" value={newDealAmount} onChange={(e) => setNewDealAmount(Number(e.target.value))} className="ui-input" />
                </div>
                <div className="mt-6 flex justify-end gap-2 border-t border-zinc-200 pt-4">
                    <button onClick={() => setIsModalOpen(false)} className="ui-btn ui-btn-secondary">Annuler</button>
                    <button onClick={createDeal} disabled={!newDealTitle} className="ui-btn ui-btn-primary disabled:opacity-50">Créer</button>
                </div>
             </div>
      </SlideOver>

      {/* SALE CAPTURE MODAL (business step before won side-effects) */}
      <Modal isOpen={isSaleCaptureModalOpen} onClose={() => setIsSaleCaptureModalOpen(false)} maxWidth="4xl" contentScroll={false}>
          <div className="w-full rounded-md bg-white p-6">
                <h3 className="mb-1 text-lg font-semibold text-primary">Informations de vente</h3>
                <p className="mb-5 text-sm text-secondary">Renseignez les données métier avant confirmation.</p>
                {isOwnerNonAdminEditingWonSale ? (
                  <p className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    Mode propriétaire: vous pouvez ajouter des fichiers, mais seul un admin peut supprimer un document déjà téléversé.
                  </p>
                ) : null}

                <div className="space-y-4 text-left">
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div>
                            <label className="ui-field-label">Client *</label>
                            <input
                              className="ui-input"
                              value={saleCaptureForm.client_name}
                              onChange={(e) => setSaleCaptureForm((prev) => ({ ...prev, client_name: e.target.value }))}
                            />
                        </div>
                        <div>
                            <label className="ui-field-label">Commercial *</label>
                            <select
                              className="ui-input"
                              value={saleCaptureForm.owner_id}
                              onChange={(e) => setSaleCaptureForm((prev) => ({ ...prev, owner_id: e.target.value }))}
                            >
                              <option value="">Sélectionner...</option>
                              {users.map((u) => (
                                <option key={u.id} value={u.id}>{u.full_name || u.email}</option>
                              ))}
                            </select>
                        </div>
                    </div>

                    <div className="space-y-2">
                      <label className="ui-field-label mb-0">Formations *</label>
                      <button
                        type="button"
                        ref={saleCaptureTrainingTriggerRef}
                        onClick={() => setIsSaleCaptureTrainingPickerOpen((prev) => !prev)}
                        className="ui-input flex h-10 w-full items-center justify-between"
                      >
                        <span className="text-sm text-zinc-700">
                          {saleCaptureForm.training_ids.length > 0
                            ? `${saleCaptureForm.training_ids.length} formation(s) sélectionnée(s)`
                            : 'Ajouter des formations au bundle'}
                        </span>
                        <ChevronDown size={14} className={`text-zinc-500 transition-transform ${isSaleCaptureTrainingPickerOpen ? 'rotate-180' : ''}`} />
                      </button>

                      {isSaleCaptureTrainingPickerOpen ? (
                        <div ref={saleCaptureTrainingPanelRef} className="rounded-md border border-zinc-200 bg-white p-2">
                          <div className="relative mb-2">
                            <Search size={14} className="pointer-events-none absolute left-2.5 top-2.5 text-zinc-400" />
                            <input
                              type="text"
                              className="ui-input"
                              style={{ paddingLeft: '2.25rem' }}
                              placeholder="Rechercher une formation..."
                              value={saleCaptureTrainingSearch}
                              onChange={(e) => setSaleCaptureTrainingSearch(e.target.value)}
                            />
                          </div>
                          <div className="max-h-52 overflow-y-auto space-y-1">
                            {trainings
                              .filter((training) => training.title.toLowerCase().includes(saleCaptureTrainingSearch.toLowerCase()))
                              .map((training) => {
                                const checked = saleCaptureForm.training_ids.includes(training.id);
                                return (
                                  <label
                                    key={training.id}
                                    className={`flex cursor-pointer items-center justify-between rounded px-2 py-1.5 text-sm ${
                                      checked ? 'bg-zinc-100 text-primary' : 'hover:bg-zinc-50'
                                    }`}
                                  >
                                    <div className="flex min-w-0 items-center gap-2">
                                      <input
                                        type="checkbox"
                                        checked={checked}
                                        onChange={() => toggleSaleCaptureTraining(training.id)}
                                      />
                                      <span className="truncate">{training.title}</span>
                                    </div>
                                    <span className="ml-2 shrink-0 text-xs text-zinc-500">{training.price} €</span>
                                  </label>
                                );
                              })}
                          </div>
                        </div>
                      ) : null}

                      <div className="rounded-md border border-zinc-200 bg-zinc-50 p-2.5">
                        {saleCaptureForm.training_ids.length === 0 ? (
                          <p className="text-xs text-zinc-500">Aucune formation sélectionnée.</p>
                        ) : (
                          <div className="flex flex-wrap gap-1.5">
                            {saleCaptureForm.training_ids.map((id) => {
                              const training = trainings.find((t) => t.id === id);
                              if (!training) return null;
                              return (
                                <span key={id} className="inline-flex items-center gap-1 rounded border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-700">
                                  <span className="max-w-[220px] truncate">{training.title}</span>
                                  <span className="text-zinc-400">•</span>
                                  <span>{training.price}€</span>
                                  <button
                                    type="button"
                                    onClick={() => toggleSaleCaptureTraining(id)}
                                    className="ml-0.5 text-zinc-400 hover:text-rose-500"
                                    title="Retirer"
                                  >
                                    <X size={12} />
                                  </button>
                                </span>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div>
                            <label className="ui-field-label">Session</label>
                            <input className="ui-input" value={saleCaptureForm.session_label} onChange={(e) => setSaleCaptureForm((prev) => ({ ...prev, session_label: e.target.value }))} />
                        </div>
                        <div>
                            <label className="ui-field-label">Montant (€) *</label>
                            <input type="number" className="ui-input" value={saleCaptureForm.amount} onChange={(e) => setSaleCaptureForm((prev) => ({ ...prev, amount: Number(e.target.value) }))} />
                        </div>
                    </div>

                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div>
                            <label className="ui-field-label">Date RDV 1ère connexion</label>
                            <input type="date" className="ui-input" value={saleCaptureForm.first_connection_date} onChange={(e) => setSaleCaptureForm((prev) => ({ ...prev, first_connection_date: e.target.value }))} />
                        </div>
                        <div>
                            <label className="ui-field-label">Heure RDV 1ère connexion</label>
                            <input type="time" className="ui-input" value={saleCaptureForm.first_connection_time} onChange={(e) => setSaleCaptureForm((prev) => ({ ...prev, first_connection_time: e.target.value }))} />
                        </div>
                    </div>

                    <label className="flex items-center gap-2 text-sm text-primary">
                      <input
                        type="checkbox"
                        checked={saleCaptureForm.first_connection_done}
                        onChange={(e) => setSaleCaptureForm((prev) => ({ ...prev, first_connection_done: e.target.checked }))}
                      />
                      1ère connexion déjà faite
                    </label>

                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div>
                            <label className="ui-field-label">Enregistrement 1 URL</label>
                            <input className="ui-input" value={saleCaptureForm.recording_1_url} onChange={(e) => setSaleCaptureForm((prev) => ({ ...prev, recording_1_url: e.target.value }))} />
                        </div>
                        <div>
                            <label className="ui-field-label">Enregistrement 1 fichier</label>
                            <input className="ui-input mb-1" value={saleCaptureForm.recording_1_file_ref} onChange={(e) => setSaleCaptureForm((prev) => ({ ...prev, recording_1_file_ref: e.target.value }))} placeholder="Référence/nom fichier" />
                            <input
                              type="file"
                              accept="audio/*"
                              onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (file) void uploadSaleAsset(file, 'recording_1');
                              }}
                              className="ui-input"
                            />
                        </div>
                    </div>

                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div>
                            <label className="ui-field-label">Enregistrement 2 URL</label>
                            <input className="ui-input" value={saleCaptureForm.recording_2_url} onChange={(e) => setSaleCaptureForm((prev) => ({ ...prev, recording_2_url: e.target.value }))} />
                        </div>
                        <div>
                            <label className="ui-field-label">Enregistrement 2 fichier</label>
                            <input className="ui-input mb-1" value={saleCaptureForm.recording_2_file_ref} onChange={(e) => setSaleCaptureForm((prev) => ({ ...prev, recording_2_file_ref: e.target.value }))} placeholder="Référence/nom fichier" />
                            <input
                              type="file"
                              accept="audio/*"
                              onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (file) void uploadSaleAsset(file, 'recording_2');
                              }}
                              className="ui-input"
                            />
                        </div>
                    </div>

                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div>
                            <label className="ui-field-label">Screen preuve URL</label>
                            <input className="ui-input" value={saleCaptureForm.proof_url} onChange={(e) => setSaleCaptureForm((prev) => ({ ...prev, proof_url: e.target.value }))} />
                        </div>
                        <div>
                            <label className="ui-field-label">Screen preuve fichier</label>
                            <input className="ui-input mb-1" value={saleCaptureForm.proof_file_ref} onChange={(e) => setSaleCaptureForm((prev) => ({ ...prev, proof_file_ref: e.target.value }))} placeholder="Référence/nom fichier" />
                            <input
                              type="file"
                              accept="image/*,.pdf,application/pdf"
                              onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (file) void uploadSaleAsset(file, 'proof');
                              }}
                              className="ui-input"
                            />
                        </div>
                    </div>

                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div>
                            <label className="ui-field-label">Commentaire</label>
                            <textarea className="ui-input min-h-[88px]" value={saleCaptureForm.sale_comment} onChange={(e) => setSaleCaptureForm((prev) => ({ ...prev, sale_comment: e.target.value }))} />
                        </div>
                        <div>
                            <label className="ui-field-label">Commentaire suivi</label>
                            <textarea className="ui-input min-h-[88px]" value={saleCaptureForm.followup_comment} onChange={(e) => setSaleCaptureForm((prev) => ({ ...prev, followup_comment: e.target.value }))} />
                        </div>
                    </div>

                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div>
                            <label className="ui-field-label">Commentaire organisme</label>
                            <textarea className="ui-input min-h-[88px]" value={saleCaptureForm.organization_comment} onChange={(e) => setSaleCaptureForm((prev) => ({ ...prev, organization_comment: e.target.value }))} />
                        </div>
                        <div>
                            <label className="ui-field-label">Commentaire désinscription</label>
                            <textarea className="ui-input min-h-[88px]" value={saleCaptureForm.unsubscription_comment} onChange={(e) => setSaleCaptureForm((prev) => ({ ...prev, unsubscription_comment: e.target.value }))} />
                        </div>
                    </div>
                </div>

                <div className="mt-5 flex gap-3">
                    <button onClick={() => setIsSaleCaptureModalOpen(false)} className="ui-btn ui-btn-secondary flex-1">Annuler</button>
                    <button onClick={handleConfirmSaleCapture} disabled={isSavingSaleCapture || isUploadingSaleAsset} className="ui-btn ui-btn-primary flex-1">
                      {isSavingSaleCapture || isUploadingSaleAsset ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                      <span>Enregistrer la vente</span>
                    </button>
                </div>
          </div>
      </Modal>

      {/* WON MODAL */}
      <Modal isOpen={isWonModalOpen} onClose={() => setIsWonModalOpen(false)}>
          <div className="w-full max-w-md rounded-md bg-white p-6 text-center">
                <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-6">
                    <PartyPopper className="text-emerald-600" size={32} />
                </div>
                <h3 className="text-2xl font-semibold text-primary mb-2">Deal Gagné !</h3>
                <p className="text-secondary mb-6">
                    {wonDealSummary ? `Vente confirmée pour "${wonDealSummary.leadName}".` : "Vente confirmée."}
                </p>
                <div className="mb-6 rounded-md border border-gray-100 bg-gray-50 p-4">
                    <div className="text-sm text-secondary">Montant final</div>
                    <div className="text-2xl font-bold text-primary">{formatEuro(wonDealSummary?.amount || 0)}</div>
                </div>

                <div className="flex gap-3">
                    <button onClick={() => setIsWonModalOpen(false)} className="ui-btn ui-btn-secondary flex-1">Fermer</button>
                    <button 
                        onClick={handleConfirmWin} 
                        className="ui-btn ui-btn-primary flex-1"
                    >
                        <Check size={16} /> <span>OK</span>
                    </button>
                </div>
          </div>
      </Modal>

      <SlideOver isOpen={!!selectedDeal} onClose={() => setSelectedDeal(null)} title="Détails Opportunité">
        {selectedDeal && (
          <div className="space-y-8 motion-fade-up">
            <div className="flex items-center gap-4">
               <div className="w-12 h-12 bg-emerald-50 text-emerald-600 rounded-full flex items-center justify-center border border-emerald-100"><CheckCircle size={24} /></div>
               <div className="flex-1">
                  <input 
                    type="text" 
                    value={selectedDeal.leadName}
                    onChange={(e) => setSelectedDeal({...selectedDeal, leadName: e.target.value})}
                    className="text-xl font-medium text-primary bg-transparent border-none p-0 focus:ring-0 w-full placeholder-gray-300"
                    placeholder="Nom du Deal"
                  />
                  <p className="text-secondary text-sm">{selectedTrainingIds.length > 0 ? `${selectedTrainingIds.length} formation(s) liée(s)` : 'Aucune formation liée'}</p>
               </div>
            </div>

            {profile?.role !== 'commercial' && !compatibilityMode && (
                <div className="p-3 bg-gray-50 rounded-md border border-border flex justify-between items-center">
                    <span className="text-secondary text-sm">Responsable</span>
                    <select 
                        value={selectedDeal.owner_id || ''} 
                        onChange={(e) => setSelectedDeal({...selectedDeal, owner_id: e.target.value})} 
                        className="bg-transparent text-sm font-medium text-primary outline-none text-right cursor-pointer hover:underline w-1/2"
                    >
                        {users.map(u => (<option key={u.id} value={u.id}>{u.full_name || u.email}</option>))}
                    </select>
                </div>
            )}

            {renderMultiSelect()}

            <div className="grid grid-cols-2 gap-4">
                <div className="rounded-md border border-border bg-gray-50 p-4">
                    <div className="flex items-center gap-2 text-secondary mb-2"><DollarSign size={16} /><span className="text-xs font-medium uppercase">Montant</span></div>
                    <div className="flex items-center">
                        <input type="number" value={newDealAmount} onChange={(e) => setNewDealAmount(Number(e.target.value))} className="bg-transparent text-2xl font-medium text-primary w-full focus:outline-none" />
                        <span className="text-secondary ml-1">€</span>
                    </div>
                </div>
                <div className="rounded-md border border-border bg-gray-50 p-4">
                    <div className="flex items-center gap-2 text-secondary mb-2"><TrendingUp size={16} /><span className="text-xs font-medium uppercase">Probabilité</span></div>
                    <div className="flex items-center">
                        <input type="number" value={selectedDeal.probability} onChange={(e) => setSelectedDeal({...selectedDeal, probability: Number(e.target.value)})} className="bg-transparent text-2xl font-medium text-primary w-full focus:outline-none" max={100} min={0} />
                        <span className="text-secondary ml-1">%</span>
                    </div>
                </div>
            </div>

            {selectedDeal.stage === 'won' && (
              <div className="space-y-3 rounded-md border border-zinc-200 bg-zinc-50 p-4">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold text-primary uppercase tracking-wide">Informations vente</h4>
                  <div className="flex items-center gap-2">
                    {selectedDealWinDetails ? (
                      <button onClick={() => setIsDealWinDetailsModalOpen(true)} className="ui-btn ui-btn-secondary h-8 px-3 py-0 text-xs">
                        Voir tout
                      </button>
                    ) : null}
                    {canEditConfirmedSale ? (
                      <button onClick={openEditConfirmedSale} className="ui-btn ui-btn-primary h-8 px-3 py-0 text-xs">
                        Modifier
                      </button>
                    ) : null}
                  </div>
                </div>
                {loadingSelectedDealWinDetails ? (
                  <p className="text-sm text-secondary">Chargement...</p>
                ) : selectedDealWinDetails ? (
                  <div className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
                    <p><span className="text-secondary">Session:</span> {selectedDealWinDetails.session_label || '-'}</p>
                    <p><span className="text-secondary">1ère connexion:</span> {selectedDealWinDetails.first_connection_date || '-'} {selectedDealWinDetails.first_connection_time || ''}</p>
                    <p><span className="text-secondary">Preuve:</span> {selectedDealWinDetails.proof_url ? <a className="text-primary underline" href={selectedDealWinDetails.proof_url} target="_blank" rel="noreferrer">Ouvrir</a> : '-'}</p>
                    <p><span className="text-secondary">Commentaire:</span> {selectedDealWinDetails.sale_comment || '-'}</p>
                    <div className="sm:col-span-2">
                      <span className="text-secondary">Formations & organismes:</span>
                      {getTrainingWithOrganizationList(selectedTrainingIds).length > 0 ? (
                        <div className="mt-1 space-y-1">
                          {getTrainingWithOrganizationList(selectedTrainingIds).map((training) => (
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

            <div className="space-y-4">
                <h4 className="ui-section-title text-primary">Étape du Pipeline</h4>
                <div className="grid grid-cols-2 gap-3">
                    {(['new', 'negotiation', 'closing', 'won'] as const).map(stageOption => (
                        <button
                            key={stageOption}
                            onClick={() => setSelectedDeal({...selectedDeal, stage: stageOption})}
                            className={`px-4 py-3 rounded-md text-sm font-medium border text-left transition-all ${selectedDeal.stage === stageOption ? 'bg-primary text-white border-primary shadow-md' : 'bg-white text-secondary border-border hover:bg-gray-50'}`}
                        >
                            {stageOption === 'new' && 'Nouveau'}
                            {stageOption === 'negotiation' && 'Négociation'}
                            {stageOption === 'closing' && 'Closing'}
                            {stageOption === 'won' && 'Gagné'}
                        </button>
                    ))}
                </div>
            </div>

            <div className="pt-6 border-t border-border flex justify-between items-center">
                <button onClick={handleDeleteDeal} className="flex items-center gap-2 px-4 py-2 text-rose-600 hover:bg-rose-50 rounded-md text-sm transition-colors"><Trash2 size={16} /> Supprimer</button>
                <button onClick={handleUpdateDeal} disabled={isUpdating} className="flex items-center gap-2 px-6 py-2 bg-primary text-white rounded-md text-sm hover:bg-black transition-colors shadow-sm disabled:opacity-70">
                    {isUpdating ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} Enregistrer
                </button>
            </div>
          </div>
        )}
      </SlideOver>

      <Modal isOpen={isDealWinDetailsModalOpen} onClose={() => setIsDealWinDetailsModalOpen(false)} maxWidth="2xl">
        <div className="w-full rounded-md bg-white p-6">
          <h3 className="mb-4 text-lg font-semibold text-primary">Informations vente (détail)</h3>
          {selectedDealWinDetails ? (
            <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
              <p><span className="text-secondary">Session:</span> {selectedDealWinDetails.session_label || '-'}</p>
              <p><span className="text-secondary">1ère connexion faite:</span> {selectedDealWinDetails.first_connection_done ? 'Oui' : 'Non'}</p>
              <p><span className="text-secondary">Date 1ère connexion:</span> {selectedDealWinDetails.first_connection_date || '-'}</p>
              <p><span className="text-secondary">Heure 1ère connexion:</span> {selectedDealWinDetails.first_connection_time || '-'}</p>
              <p><span className="text-secondary">Enregistrement 1:</span> {selectedDealWinDetails.recording_1_url ? <a href={selectedDealWinDetails.recording_1_url} target="_blank" rel="noreferrer" className="text-primary underline">Ouvrir</a> : '-'}</p>
              <p><span className="text-secondary">Enregistrement 2:</span> {selectedDealWinDetails.recording_2_url ? <a href={selectedDealWinDetails.recording_2_url} target="_blank" rel="noreferrer" className="text-primary underline">Ouvrir</a> : '-'}</p>
              <p><span className="text-secondary">Screen preuve:</span> {selectedDealWinDetails.proof_url ? <a href={selectedDealWinDetails.proof_url} target="_blank" rel="noreferrer" className="text-primary underline">Ouvrir</a> : '-'}</p>
              <div className="sm:col-span-2">
                <span className="text-secondary">Formations & organismes:</span>
                {getTrainingWithOrganizationList(selectedTrainingIds).length > 0 ? (
                  <div className="mt-1 space-y-1">
                    {getTrainingWithOrganizationList(selectedTrainingIds).map((training) => (
                      <p key={training.title}>
                        {training.title} <span className="text-secondary">— {training.organization || 'Organisme non renseigné'}</span>
                      </p>
                    ))}
                  </div>
                ) : (
                  <span className="ml-1">-</span>
                )}
              </div>
              <p><span className="text-secondary">Commentaire vente:</span> {selectedDealWinDetails.sale_comment || '-'}</p>
              <p><span className="text-secondary">Commentaire suivi:</span> {selectedDealWinDetails.followup_comment || '-'}</p>
              <p><span className="text-secondary">Commentaire organisme:</span> {selectedDealWinDetails.organization_comment || '-'}</p>
              <p className="sm:col-span-2"><span className="text-secondary">Commentaire désinscription:</span> {selectedDealWinDetails.unsubscription_comment || '-'}</p>
            </div>
          ) : (
            <p className="text-sm text-secondary">Aucune donnée.</p>
          )}
          <div className="mt-6 flex justify-end">
            <button onClick={() => setIsDealWinDetailsModalOpen(false)} className="ui-btn ui-btn-primary">Fermer</button>
          </div>
        </div>
      </Modal>

      {/* Contextual workflow modal (URL-driven via ?action=create-task&leadId=...) */}
      <TaskModal />
    </div>
  );
};

export default Pipeline;
