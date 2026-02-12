import React, { useState, useEffect, useRef } from 'react';
import { Badge, SectionTitle, Modal, SlideOver, Avatar } from '@/components/Common';
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
    className="flex-1 min-w-[280px] flex flex-col h-full bg-gray-50/30 rounded-lg p-2 transition-colors hover:bg-gray-50/80"
    onDrop={(e) => onDrop(e, stage)}
    onDragOver={onDragOver}
  >
    <div className="flex justify-between items-baseline mb-4 px-2 pt-2">
      <h3 className="text-sm font-bold text-secondary uppercase tracking-wider flex items-center gap-2">
          {stage === 'won' && <Award size={14} className="text-emerald-500" />}
          {title} 
          <span className="bg-gray-100 text-gray-500 text-[10px] px-1.5 py-0.5 rounded-full ml-1">{deals.length}</span>
      </h3>
      <span className="text-xs text-gray-400 font-mono font-medium">{totalValue.toLocaleString()} €</span>
    </div>
    <div className="space-y-3 flex-1 overflow-y-auto px-1">
      {deals.map((deal, idx) => (
        <div 
          key={deal.id} 
          draggable
          onDragStart={(e) => onDragStart(e, deal.id)}
          onClick={() => onSelectDeal(deal)}
          className="group bg-surface border border-border p-4 rounded-lg shadow-sm hover:shadow-float hover:border-primary/20 transition-all duration-300 cursor-grab active:cursor-grabbing relative transform hover:-translate-y-1 micro-interaction animate-enter"
          style={{ animationDelay: `${idx * 50}ms` }}
        >
          <div className="flex justify-between items-start mb-2">
            <div className="flex flex-col gap-1">
                {deal.trainings && deal.trainings.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                        {deal.trainings.slice(0, 1).map((t, idx) => (
                            <span key={idx} className="text-[10px] px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded border border-gray-200 truncate max-w-[150px]">
                                {t.title}
                            </span>
                        ))}
                        {deal.trainings.length > 1 && (
                            <span className="text-[10px] px-1.5 py-0.5 bg-gray-50 text-gray-400 rounded border border-gray-100">
                                +{deal.trainings.length - 1}
                            </span>
                        )}
                    </div>
                ) : (
                    // Fallback for Legacy Data (String)
                    deal.training ? (
                         <span className="text-[10px] px-1.5 py-0.5 bg-gray-50 text-gray-500 rounded border border-gray-200 truncate max-w-[150px] inline-block">{deal.training}</span>
                    ) : (
                         <span className="text-xs font-medium text-gray-400 italic">Sans formation</span>
                    )
                )}
            </div>
            {deal.assignee ? (
                <div title={deal.assignee.full_name}>
                    <Avatar name={deal.assignee.full_name} src={deal.assignee.avatar_url} size="sm" />
                </div>
            ) : (
                <div title="Non assigné">
                    <Avatar name="?" size="sm" />
                </div>
            )}
          </div>
          
          <h4 className="font-semibold text-primary mb-3 text-sm">{deal.leadName}</h4>
          
          <div className="flex justify-between items-center mt-3 pt-3 border-t border-gray-50">
            <Badge variant={deal.probability > 75 ? 'success' : 'neutral'}>{deal.amount} €</Badge>
            <div className="text-xs text-gray-400 flex items-center gap-1 font-mono">
                {deal.probability}%
            </div>
          </div>
        </div>
      ))}
      
      {deals.length === 0 && (
        <div className="h-24 border border-dashed border-border rounded-lg flex items-center justify-center text-xs text-gray-300 bg-white/50">
          Glisser ici
        </div>
      )}

      {stage === 'new' && (
        <button 
            onClick={onOpenCreate}
            className="w-full py-2 text-sm text-gray-400 border border-dashed border-gray-200 rounded-md hover:border-gray-300 hover:text-gray-600 transition-colors flex items-center justify-center gap-2 micro-interaction"
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

  useEffect(() => {
    if (user) {
        fetchDeals();
        fetchTrainings();
        setNewDealOwner(user.id);
    }
  }, [user]);

  // Click outside listener for dropdown
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowTrainingDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

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
    (rows || []).map((d: any) => ({
      id: d.id,
      leadName: d.title,
      training: d.training,
      amount: d.amount,
      stage: d.stage as Deal['stage'],
      probability: d.probability,
      owner: d.owner?.full_name || 'Inconnu',
      owner_id: d.owner_id,
      assignee: d.owner,
      trainings: d.deal_trainings?.map((dt: any) => dt.training).filter(Boolean) || []
    }));

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
        <label className="block text-sm font-medium text-secondary mb-1">Formations associées</label>
        <div className="flex flex-wrap gap-2 mb-2">
            {selectedTrainingIds.map(id => {
                let t = trainings.find(tr => tr.id === id);
                if (!t && selectedDeal && selectedDeal.trainings) t = selectedDeal.trainings.find(tr => tr.id === id);
                return t ? (<span key={id} className="inline-flex items-center gap-1 px-2 py-1 rounded bg-gray-100 border border-gray-200 text-xs font-medium text-primary">{t.title}<button onClick={() => toggleTrainingSelection(id)} className="hover:text-red-500"><X size={12} /></button></span>) : null;
            })}
        </div>
        <div className="relative">
            <input type="text" placeholder="Rechercher une formation..." value={trainingSearch} onChange={(e) => { setTrainingSearch(e.target.value); setShowTrainingDropdown(true); }} onFocus={() => setShowTrainingDropdown(true)} className="w-full px-3 py-2 border border-border rounded-md text-sm outline-none bg-white pr-8" />
            <div className="absolute right-2 top-2.5 text-gray-400 pointer-events-none"><Search size={14} /></div>
        </div>
        {showTrainingDropdown && (
            <div className="absolute z-10 w-full mt-1 bg-white border border-border rounded-md shadow-lg max-h-48 overflow-y-auto">
                {trainings.filter(t => t.title.toLowerCase().includes(trainingSearch.toLowerCase())).map(t => (
                    <div key={t.id} onClick={() => { toggleTrainingSelection(t.id); setTrainingSearch(''); }} className={`px-3 py-2 text-sm cursor-pointer flex items-center justify-between hover:bg-gray-50 ${selectedTrainingIds.includes(t.id) ? 'bg-blue-50' : ''}`}>
                        <div><p className="font-medium text-primary">{t.title}</p><p className="text-xs text-secondary">{t.price} €</p></div>
                        {selectedTrainingIds.includes(t.id) && <Check size={14} className="text-blue-600" />}
                    </div>
                ))}
            </div>
        )}
    </div>
  );

  if (loading) return <div className="flex h-full items-center justify-center"><Loader2 className="animate-spin text-gray-400" /></div>;

  return (
    <div className="animate-fade-in h-full flex flex-col">
      <div className="flex justify-between items-center mb-6">
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
                className="hidden sm:flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 text-primary rounded-md text-sm hover:bg-gray-50 transition-colors shadow-sm micro-interaction"
            >
                <Award size={16} className="text-emerald-500" /> Ajouter une vente
            </button>

            <button 
                onClick={() => setIsModalOpen(true)}
                className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-md text-sm hover:bg-black transition-colors shadow-sm micro-interaction"
            >
                <Plus size={16} /> <span className="hidden sm:inline">Nouvelle opportunité</span>
            </button>
         </div>
      </div>

      <FilterBar />
      
      {errorState ? (
          <div className="flex flex-col items-center justify-center h-64 bg-gray-50 rounded-lg border border-red-100 p-8 text-center">
              <AlertCircle className="text-red-400 mb-3" size={32} />
              <h3 className="text-primary font-medium mb-1">Erreur de chargement</h3>
              <p className="text-sm text-secondary mb-4">La structure de la base de données ne correspond pas à la version actuelle de l'application.</p>
          </div>
      ) : (
        <>
            {compatibilityMode && (
                <div className="mb-4 p-3 bg-blue-50 text-blue-700 text-xs rounded border border-blue-100 flex items-start justify-between gap-2">
                    <div className="flex gap-2">
                        <AlertCircle size={14} className="shrink-0 mt-0.5" /> 
                        <div>
                            <span className="font-semibold block mb-0.5">Mode compatibilité activé</span>
                            <span className="opacity-90">La base de données n'est pas synchronisée avec la V2.</span>
                            {compatibilityError && <div className="mt-1 font-mono text-[10px] bg-blue-100/50 p-1 rounded text-blue-800">{compatibilityError}</div>}
                        </div>
                    </div>
                    <button 
                        onClick={() => fetchDeals()}
                        className="flex items-center gap-1.5 px-3 py-1 bg-white border border-blue-200 text-blue-700 rounded text-xs font-medium hover:bg-blue-50 transition-colors shadow-sm whitespace-nowrap"
                    >
                        <RefreshCw size={12} /> Réessayer
                    </button>
                </div>
            )}
            <div className="flex gap-6 overflow-x-auto pb-6 h-full">
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
                        onOpenCreate={() => setIsModalOpen(true)}
                        onSelectDeal={handleSelectDeal}
                    />
                ))}
            </div>
        </>
      )}

      {/* CREATE MODAL */}
      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)}>
        <div className="bg-surface p-6 rounded-lg w-full max-w-md overflow-visible">
             <h3 className="text-lg font-medium text-primary mb-4">Nouvelle Opportunité</h3>
             <div className="space-y-4">
                <div>
                    <label className="block text-sm font-medium text-secondary mb-1">Nom du prospect / Deal</label>
                    <input type="text" value={newDealTitle} onChange={(e) => setNewDealTitle(e.target.value)} className="w-full px-3 py-2 border border-border rounded-md text-sm outline-none focus:ring-1 focus:ring-primary" placeholder="Ex: Dr. House" />
                </div>
                
                {profile?.role !== 'commercial' && !compatibilityMode && (
                    <div>
                        <label className="block text-sm font-medium text-secondary mb-1">Attribuer à</label>
                        <select value={newDealOwner} onChange={(e) => setNewDealOwner(e.target.value)} className="w-full px-3 py-2 border border-border rounded-md text-sm bg-white">
                            <option value="">Moi-même</option>
                            {users.map(u => (<option key={u.id} value={u.id}>{u.full_name || u.email}</option>))}
                        </select>
                    </div>
                )}

                {renderMultiSelect()}
                <div>
                    <label className="block text-sm font-medium text-secondary mb-1">Montant estimé (€)</label>
                    <input type="number" value={newDealAmount} onChange={(e) => setNewDealAmount(Number(e.target.value))} className="w-full px-3 py-2 border border-border rounded-md text-sm outline-none focus:ring-1 focus:ring-primary" />
                </div>
                <div className="flex justify-end gap-3 mt-6">
                    <button onClick={() => setIsModalOpen(false)} className="px-4 py-2 text-sm text-secondary hover:bg-gray-50 rounded-md">Annuler</button>
                    <button onClick={createDeal} disabled={!newDealTitle} className="px-4 py-2 bg-primary text-white text-sm rounded-md hover:bg-black disabled:opacity-50">Créer</button>
                </div>
             </div>
        </div>
      </Modal>

      {/* WON MODAL */}
      <Modal isOpen={isWonModalOpen} onClose={() => setIsWonModalOpen(false)}>
          <div className="bg-white p-8 rounded-lg max-w-md w-full text-center">
                <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-6">
                    <PartyPopper className="text-emerald-600" size={32} />
                </div>
                <h3 className="text-2xl font-semibold text-primary mb-2">Deal Gagné !</h3>
                <p className="text-secondary mb-6">
                    {dealToWin ? `Confirmez-vous le closing de "${dealToWin.leadName}" ?` : "Enregistrement d'une nouvelle vente directe."}
                </p>

                {!dealToWin && (
                    <div className="mb-6 text-left space-y-3">
                         <input type="text" placeholder="Nom du client" value={newDealTitle} onChange={(e) => setNewDealTitle(e.target.value)} className="w-full px-3 py-2 border border-border rounded-md text-sm" />
                         <input type="number" placeholder="Montant (€)" value={newDealAmount} onChange={(e) => setNewDealAmount(Number(e.target.value))} className="w-full px-3 py-2 border border-border rounded-md text-sm" />
                    </div>
                )}
                
                {dealToWin && (
                    <div className="bg-gray-50 p-4 rounded-lg mb-6 border border-gray-100">
                        <div className="text-sm text-secondary">Montant final</div>
                        <div className="text-2xl font-bold text-primary">{dealToWin.amount.toLocaleString()} €</div>
                    </div>
                )}

                <div className="flex gap-3">
                    <button onClick={() => setIsWonModalOpen(false)} className="flex-1 py-2.5 border border-gray-200 rounded-md text-sm font-medium hover:bg-gray-50">Annuler</button>
                    <button 
                        onClick={handleConfirmWin} 
                        className="flex-1 py-2.5 bg-primary text-white rounded-md text-sm font-medium hover:bg-zinc-800 transition-all shadow-sm border border-transparent flex items-center justify-center gap-2"
                    >
                        <Check size={16} /> <span>Confirmer la vente</span>
                    </button>
                </div>
          </div>
      </Modal>

      <SlideOver isOpen={!!selectedDeal} onClose={() => setSelectedDeal(null)} title="Détails Opportunité">
        {selectedDeal && (
          <div className="space-y-8">
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
                <div className="p-4 bg-gray-50 rounded-lg border border-border">
                    <div className="flex items-center gap-2 text-secondary mb-2"><DollarSign size={16} /><span className="text-xs font-medium uppercase">Montant</span></div>
                    <div className="flex items-center">
                        <input type="number" value={newDealAmount} onChange={(e) => setNewDealAmount(Number(e.target.value))} className="bg-transparent text-2xl font-medium text-primary w-full focus:outline-none" />
                        <span className="text-secondary ml-1">€</span>
                    </div>
                </div>
                <div className="p-4 bg-gray-50 rounded-lg border border-border">
                    <div className="flex items-center gap-2 text-secondary mb-2"><TrendingUp size={16} /><span className="text-xs font-medium uppercase">Probabilité</span></div>
                    <div className="flex items-center">
                        <input type="number" value={selectedDeal.probability} onChange={(e) => setSelectedDeal({...selectedDeal, probability: Number(e.target.value)})} className="bg-transparent text-2xl font-medium text-primary w-full focus:outline-none" max={100} min={0} />
                        <span className="text-secondary ml-1">%</span>
                    </div>
                </div>
            </div>

            <div className="space-y-4">
                <h4 className="text-sm font-medium text-primary uppercase tracking-wide">Étape du Pipeline</h4>
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
