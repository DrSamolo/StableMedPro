import React, { useState, useEffect, useRef } from 'react';
import { SectionTitle, Modal, SlideOver, Avatar, SectionLoader } from '@/components/Common';
import { FilterBar } from '@/components/FilterBar';
import { Deal, Training } from '@/types';
import { MoreHorizontal, Plus, Loader2, Trash2, Save, Calendar, DollarSign, TrendingUp, CheckCircle, Search, X, Check, Award, PartyPopper, AlertCircle, RefreshCw } from 'lucide-react';
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
  email: string | null;
  phone: string | null;
  profession: string | null;
  location: string | null;
};

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
    className="flex h-full min-w-[280px] flex-1 flex-col rounded-md border border-zinc-200 bg-zinc-50/40 p-2.5 motion-fade-up"
    onDrop={(e) => onDrop(e, stage)}
    onDragOver={onDragOver}
  >
    <div className="mb-3 flex items-center justify-between px-1 pt-1.5">
      <h3 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-zinc-500">
          {stage === 'won' && <Award size={13} className="text-zinc-500" />}
          {title} 
          <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-white px-1.5 text-[10px] font-semibold text-zinc-500">{deals.length}</span>
      </h3>
      <span className="text-[11px] font-medium tabular-nums text-zinc-500">{totalValue.toLocaleString()} €</span>
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
            <div className="text-sm font-semibold tabular-nums text-zinc-900">{deal.amount.toLocaleString()} €</div>
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

  // Won Modal State
  const [isWonModalOpen, setIsWonModalOpen] = useState(false);
  const [dealToWin, setDealToWin] = useState<Deal | null>(null);

  // Detail SlideOver State
  const [selectedDeal, setSelectedDeal] = useState<Deal | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);

  // Multi-Select State
  const [selectedTrainingIds, setSelectedTrainingIds] = useState<string[]>([]);
  const [trainingSearch, setTrainingSearch] = useState('');
  const [showTrainingDropdown, setShowTrainingDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const leadDropdownRef = useRef<HTMLDivElement>(null);

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

  // Click outside listener for dropdown
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowTrainingDropdown(false);
      }
      if (leadDropdownRef.current && !leadDropdownRef.current.contains(event.target as Node)) {
        setShowLeadDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const fetchLeadOptions = async () => {
    if (!user) return;

    let query: any = supabase
      .from('leads')
      .select('id,name,user_id,email,phone,profession,location,profiles:user_id ( team_id )')
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
      email: row.email ?? null,
      phone: row.phone ?? null,
      profession: row.profession ?? null,
      location: row.location ?? null,
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
                    id,title,training,amount,stage,probability,owner_id,created_at,
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
          .select('id,title,price')
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

  const createDeal = async () => {
    if(!user || !newDealTitle) return;

    const trainingTitles = trainings
        .filter(t => selectedTrainingIds.includes(t.id))
        .map(t => t.title).join(', ');

    const payload: any = {
        title: newDealTitle,
        training: trainingTitles,
        amount: newDealAmount,
        stage: 'new',
        probability: 20
    };

    if (newDealLeadId) {
        payload.lead_id = newDealLeadId;
    }

    if (!compatibilityMode) {
        payload.owner_id = newDealOwner || user.id;
    }

    const { data: dealData, error } = await supabase.from('deals').insert([payload]).select().single();

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

  const filteredDeals = deals.filter(deal => {
      if (compatibilityMode) return true;
      const matchesUser = selectedUserId === 'all' || deal.owner_id === selectedUserId;
      const matchesTeam = selectedTeamId === 'all' || deal.assignee?.team_id === selectedTeamId;
      return matchesUser && matchesTeam;
  });

  const getDealsByStage = (stage: Deal['stage']) => filteredDeals.filter(d => d.stage === stage);
  const getTotal = (stageDeals: Deal[]) => stageDeals.reduce((acc, curr) => acc + curr.amount, 0);

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
        setDealToWin(deal);
        setIsWonModalOpen(true);
        return;
    }

    if (newStage === previousStage) return;

    await updateDealStage(dealId, newStage);

    // Smart trigger: opening task modal contextually after a stage move.
    const params = new URLSearchParams(window.location.search);
    params.set('action', 'create-task');
    params.set('leadId', deal.id);
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
      if (!dealToWin) return;
      
      // Update DB
      await updateDealStage(dealToWin.id, 'won');

      const salesPersonName = profile?.full_name || 'Un commercial';
      const { error: allHandsError } = await supabase.rpc('publish_sale_announcement_to_all_chat', {
          p_lead_name: dealToWin.leadName,
          p_amount: dealToWin.amount,
          p_currency: 'EUR',
      });

      if (allHandsError) {
          console.error('[Chat @all] publication erreur:', allHandsError.message);
      }

      // In-App Notification for Manager/Admin
      pushAppNotification(
          'Vente Confirmée !',
          `${salesPersonName} a signé ${dealToWin.leadName} pour ${dealToWin.amount}€ !`,
          'success'
      );

      setIsWonModalOpen(false);
      setDealToWin(null);
      if (allHandsError) {
          addNotification('warning', 'Vente enregistree, mais publication chat @all indisponible.');
      } else {
          addNotification('success', 'Felicitations ! Vente enregistree et annoncee dans @all.');
      }
  };

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
                    setNewDealAmount(0);
                    setNewDealTitle('');
                    setSelectedTrainingIds([]);
                    setIsWonModalOpen(true);
                    setDealToWin(null); 
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
            <div className="flex h-full gap-6 overflow-x-auto pb-6">
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

      {/* WON MODAL */}
      <Modal isOpen={isWonModalOpen} onClose={() => setIsWonModalOpen(false)}>
          <div className="w-full max-w-md rounded-md bg-white p-6 text-center">
                <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-6">
                    <PartyPopper className="text-emerald-600" size={32} />
                </div>
                <h3 className="text-2xl font-semibold text-primary mb-2">Deal Gagné !</h3>
                <p className="text-secondary mb-6">
                    {dealToWin ? `Confirmez-vous le closing de "${dealToWin.leadName}" ?` : "Enregistrement d'une nouvelle vente directe."}
                </p>

                {!dealToWin && (
                    <div className="mb-6 text-left space-y-3">
                         <input type="text" placeholder="Nom du client" value={newDealTitle} onChange={(e) => setNewDealTitle(e.target.value)} className="ui-input" />
                         <input type="number" placeholder="Montant (€)" value={newDealAmount} onChange={(e) => setNewDealAmount(Number(e.target.value))} className="ui-input" />
                    </div>
                )}
                
                {dealToWin && (
                    <div className="mb-6 rounded-md border border-gray-100 bg-gray-50 p-4">
                        <div className="text-sm text-secondary">Montant final</div>
                        <div className="text-2xl font-bold text-primary">{dealToWin.amount.toLocaleString()} €</div>
                    </div>
                )}

                <div className="flex gap-3">
                    <button onClick={() => setIsWonModalOpen(false)} className="ui-btn ui-btn-secondary flex-1">Annuler</button>
                    <button 
                        onClick={handleConfirmWin} 
                        className="ui-btn ui-btn-primary flex-1"
                    >
                        <Check size={16} /> <span>Confirmer la vente</span>
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
                <button className="flex items-center gap-2 px-4 py-2 text-rose-600 hover:bg-rose-50 rounded-md text-sm transition-colors"><Trash2 size={16} /> Supprimer</button>
                <button onClick={handleUpdateDeal} disabled={isUpdating} className="flex items-center gap-2 px-6 py-2 bg-primary text-white rounded-md text-sm hover:bg-black transition-colors shadow-sm disabled:opacity-70">
                    {isUpdating ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} Enregistrer
                </button>
            </div>
          </div>
        )}
      </SlideOver>

      {/* Contextual workflow modal (URL-driven via ?action=create-task&leadId=...) */}
      <TaskModal />
    </div>
  );
};

export default Pipeline;
