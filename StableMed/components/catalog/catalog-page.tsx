import React, { useEffect, useState } from 'react';
import { SectionLoader, SectionTitle, Modal, SlideOver, CustomSelect } from '@/components/Common';
import { Training } from '@/types';
import { Search, Plus, Trash2, Loader2, Image as ImageIcon, X, FileText, Banknote, User, Users, BookOpen, Monitor, GraduationCap, Briefcase, Building, ChevronRight, Clock, List, LayoutGrid, Link2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useNotification } from '@/contexts/NotificationContext';
import { getCached, invalidateCached, setCached } from '@/lib/perf/cache';
import { perfEnd, perfStart } from '@/lib/perf/metrics';
import { useSectionPerf } from '@/lib/perf/use-section-perf';

const CATALOG_CACHE_TTL_MS = 90_000;
const CATALOG_FIRST_PAGE_CACHE_TTL_MS = 30_000;
const CATALOG_DETAILS_CACHE_TTL_MS = 10 * 60_000;
const CATALOG_PAGE_SIZE = 120;
const CATALOG_MAX_ROWS = 600;
const CATALOG_FIRST_PAGE_SIZE = 120;

const Catalog: React.FC = () => {
  const { user, profile, permissions } = useAuth();
  const { addNotification } = useNotification();
  const [trainings, setTrainings] = useState<Training[]>([]);
  const [loading, setLoading] = useState(true);
  useSectionPerf('catalog', loading);
  
  // Selection & Details
  const [selectedTraining, setSelectedTraining] = useState<Training | null>(null);
  const [loadingTrainingDetails, setLoadingTrainingDetails] = useState(false);

  // Search & Filter State
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedTarget, setSelectedTarget] = useState('all');
  const [selectedType, setSelectedType] = useState('all');
  const [selectedOrg, setSelectedOrg] = useState('all');
  const [viewMode, setViewMode] = useState<'grid' | 'table'>('grid');
  const [isAssociateModalOpen, setIsAssociateModalOpen] = useState(false);
  const [trainingToAssociate, setTrainingToAssociate] = useState<Training | null>(null);
  const [associateTargetType, setAssociateTargetType] = useState<'lead' | 'deal'>('lead');
  const [associateTargetId, setAssociateTargetId] = useState('');
  const [isAssociating, setIsAssociating] = useState(false);
  const [isLoadingAssociationTargets, setIsLoadingAssociationTargets] = useState(false);
  const [assignableLeads, setAssignableLeads] = useState<Array<{ id: string; name: string; email?: string }>>([]);
  const [assignableDeals, setAssignableDeals] = useState<Array<{ id: string; title: string }>>([]);
  
  // Create Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [newTraining, setNewTraining] = useState<Partial<Training>>({
    title: '',
    target_audience: 'Infirmier diplômé d\'État',
    training_type: 'Formation Continue',
    format: 'E-Learning',
    duration_total: '4 heures',
    price: 0,
    compensation: 0,
    funder: 'DPC',
    organization: 'WALTER',
    reference: `REF-${Math.floor(Math.random() * 10000)}`,
    instructor_name: '',
    instructor_bio: '',
    program_details: '',
    image: ''
  });

  // Delete Confirmation State
  const [trainingToDelete, setTrainingToDelete] = useState<Training | null>(null);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);

  // Explicit check for admin role OR permission. 
  // This acts as a fallback if permissions fail to load or are desynchronized.
  const canManageCatalog = (permissions['can_manage_catalog'] === true) || (profile?.role === 'admin');

  useEffect(() => {
    if (!user) return;
    let active = true;
    void fetchTrainings(() => active);
    return () => {
      active = false;
    };
  }, [user]);

  useEffect(() => {
    if (!selectedTraining) {
      setLoadingTrainingDetails(false);
      return;
    }
    const missingDetails =
      typeof selectedTraining.program_details === 'undefined' ||
      typeof selectedTraining.instructor_bio === 'undefined';
    if (!missingDetails) return;

    let isMounted = true;
    const detailsCacheKey = `catalog:details:${selectedTraining.id}`;
    const cachedDetails = getCached<Training>(detailsCacheKey, CATALOG_DETAILS_CACHE_TTL_MS);
    if (cachedDetails) {
      setSelectedTraining(cachedDetails);
      setLoadingTrainingDetails(false);
      return;
    }
    setLoadingTrainingDetails(true);

    void (async () => {
      const { data, error } = await supabase.from('trainings').select('*').eq('id', selectedTraining.id).single();
      if (!isMounted) return;
      if (!error && data) {
        setSelectedTraining(data as Training);
        setCached(detailsCacheKey, data as Training);
      }
      setLoadingTrainingDetails(false);
    })();

    return () => {
      isMounted = false;
    };
  }, [selectedTraining]);

  const mergeById = (base: Training[], incoming: Training[]) => {
    const map = new Map<string, Training>();
    base.forEach((item) => map.set(item.id, item));
    incoming.forEach((item) => map.set(item.id, item));
    return Array.from(map.values());
  };

  const fetchTrainings = async (isActive: () => boolean = () => true) => {
    perfStart('catalog.fetch');
    const cacheKey = `catalog:list:${user?.id ?? 'anon'}`;
    const firstPageCacheKey = `catalog:first:${user?.id ?? 'anon'}`;
    const cached = getCached<Training[]>(cacheKey, CATALOG_CACHE_TTL_MS);
    if (cached) {
      setTrainings(cached);
      setLoading(false);
      perfEnd('catalog.fetch');
      return;
    }
    const cachedFirstPage = getCached<Training[]>(firstPageCacheKey, CATALOG_FIRST_PAGE_CACHE_TTL_MS);
    if (cachedFirstPage) {
      setTrainings(cachedFirstPage);
      setLoading(false);
    }

    const fetchPage = async (cursor: string | null, limit: number) => {
      let query = supabase
        .from('trainings')
        .select('id,title,target_audience,training_type,format,organization,price,image,status,created_at')
        .order('id', { ascending: false })
        .limit(limit);
      if (cursor) {
        query = query.lt('id', cursor);
      }
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as (Training & { created_at?: string | null })[];
    };

    const normalizePage = (page: (Training & { created_at?: string | null })[]) =>
      page.map((row) => {
        const { created_at: _createdAt, ...rest } = row as Training & { created_at?: string | null };
        void _createdAt;
        return rest as Training;
      });

    try {
      const firstPage = await fetchPage(null, CATALOG_FIRST_PAGE_SIZE);
      if (!isActive()) return;

      const normalizedFirstPage = normalizePage(firstPage);
      setTrainings(normalizedFirstPage);
      setLoading(false);
      setCached(firstPageCacheKey, normalizedFirstPage);

      void (async () => {
        try {
          let cursor: string | null = firstPage[firstPage.length - 1]?.id ?? null;
          let reachedEnd = firstPage.length < CATALOG_FIRST_PAGE_SIZE;
          let allRows = [...normalizedFirstPage];
          let totalLoaded = allRows.length;

          while (!reachedEnd && totalLoaded < CATALOG_MAX_ROWS) {
            const page = await fetchPage(cursor, CATALOG_PAGE_SIZE);
            if (!isActive()) return;

            if (page.length === 0) {
              reachedEnd = true;
              break;
            }

            const normalizedPage = normalizePage(page);
            allRows = mergeById(allRows, normalizedPage);
            totalLoaded += normalizedPage.length;
            cursor = page[page.length - 1]?.id ?? null;

            if (page.length < CATALOG_PAGE_SIZE || !cursor) {
              reachedEnd = true;
            }
          }

          if (isActive()) {
            setTrainings(allRows);
          }
          setCached(cacheKey, allRows);
        } catch (backgroundError) {
          console.error('Error hydrating full catalog in background:', backgroundError);
        }
      })();
    } catch (error) {
      console.error('Error fetching trainings:', error);
    } finally {
      if (isActive()) {
        setLoading(false);
      }
      perfEnd('catalog.fetch');
    }
  };

  const handleCreateTraining = async () => {
    if (!user || !newTraining.title?.trim()) {
        addNotification('error', 'Le titre est obligatoire.');
        return;
    }
    setIsSubmitting(true);
    const normalizedPrice = Number(newTraining.price ?? 0);
    const normalizedCompensation = Number(newTraining.compensation ?? 0);
    if (Number.isNaN(normalizedPrice) || Number.isNaN(normalizedCompensation)) {
        addNotification('error', 'Prix/indemnité invalides.');
        setIsSubmitting(false);
        return;
    }

    // Prepare full data object
    const fullTrainingData = {
        title: newTraining.title,
        target_audience: newTraining.target_audience,
        training_type: newTraining.training_type,
        format: newTraining.format,
        duration_total: newTraining.duration_total,
        price: normalizedPrice,
        compensation: normalizedCompensation,
        funder: newTraining.funder,
        organization: newTraining.organization,
        reference: newTraining.reference,
        instructor_name: newTraining.instructor_name,
        instructor_bio: newTraining.instructor_bio,
        program_details: newTraining.program_details,
        status: 'Actif',
        image: newTraining.image || 'https://images.unsplash.com/photo-1576091160399-112ba8d25d1d?auto=format&fit=crop&q=80&w=600'
    };

    try {
        // Attempt 1: Full insert
        const { error } = await supabase.from('trainings').insert([fullTrainingData]);

        if (error) {
            // Check for Schema Cache issues (Column not found)
            if (error.message.includes('schema cache') || error.message.includes('column') || error.code === '42703') {
                console.warn("Full insert failed due to schema mismatch. Attempting partial insert fallback.");
                
                // Attempt 2: Minimal insert (Fallback)
                // We only insert fields that are guaranteed to exist in the base table
                const { error: fallbackError } = await supabase.from('trainings').insert([{
                    title: newTraining.title,
                    // Skipping new fields to avoid crash
                }]);

                if (fallbackError) throw fallbackError;
                invalidateCached('catalog:list:');
                invalidateCached('catalog:details:');

                addNotification('warning', 'Formation créée en mode simplifié (Problème de cache DB). Allez dans Paramètres > Base de données pour rafraîchir le schéma.');
            } else {
                throw error;
            }
        } else {
            invalidateCached('catalog:list:');
            invalidateCached('catalog:details:');
            addNotification('success', 'Formation créée avec succès');
        }

        setIsModalOpen(false);
        // Reset form
        setNewTraining({
            title: '',
            target_audience: 'Infirmier diplômé d\'État',
            training_type: 'Formation Continue',
            format: 'E-Learning',
            duration_total: '4 heures',
            price: 0,
            compensation: 0,
            funder: 'DPC',
            organization: 'WALTER',
            reference: `REF-${Math.floor(Math.random() * 10000)}`,
            instructor_name: '',
            instructor_bio: '',
            program_details: '',
            image: ''
        });
        fetchTrainings();
        
    } catch (error: any) {
        addNotification('error', 'Erreur: ' + error.message);
    } finally {
        setIsSubmitting(false);
    }
  };

  const confirmDelete = async () => {
    if (!trainingToDelete) return;

    try {
        const { error } = await supabase.from('trainings').delete().eq('id', trainingToDelete.id);
        
        if (error) throw error;

        invalidateCached('catalog:list:');
        invalidateCached('catalog:details:');
        setTrainings(prev => prev.filter(t => t.id !== trainingToDelete.id));
        if (selectedTraining?.id === trainingToDelete.id) setSelectedTraining(null);
        addNotification('success', 'Formation supprimée du catalogue');
    } catch (error: any) {
        console.error("Delete Error:", error);
        addNotification('error', 'Erreur lors de la suppression : ' + error.message);
    } finally {
        setIsDeleteModalOpen(false);
        setTrainingToDelete(null);
    }
  };

  const handleRequestDelete = (training: Training, e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setTrainingToDelete(training);
      setIsDeleteModalOpen(true);
  };

  const loadAssociationTargets = async () => {
    setIsLoadingAssociationTargets(true);
    try {
      const [leadsRes, dealsRes] = await Promise.all([
        supabase.from('leads').select('id,name,email').order('created_at', { ascending: false }).limit(300),
        supabase.from('deals').select('id,title').order('created_at', { ascending: false }).limit(300),
      ]);

      if (leadsRes.error) throw leadsRes.error;
      if (dealsRes.error) throw dealsRes.error;

      setAssignableLeads((leadsRes.data ?? []) as Array<{ id: string; name: string; email?: string }>);
      setAssignableDeals((dealsRes.data ?? []) as Array<{ id: string; title: string }>);
    } catch (error: any) {
      addNotification('error', `Erreur chargement des cibles: ${error.message}`);
    } finally {
      setIsLoadingAssociationTargets(false);
    }
  };

  const handleOpenAssociateModal = async (training: Training, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setTrainingToAssociate(training);
    setAssociateTargetType('lead');
    setAssociateTargetId('');
    setIsAssociateModalOpen(true);
    await loadAssociationTargets();
  };

  const handleAssociateTraining = async () => {
    if (!trainingToAssociate || !associateTargetId) {
      addNotification('warning', 'Sélectionnez une cible à associer.');
      return;
    }
    setIsAssociating(true);
    try {
      if (associateTargetType === 'deal') {
        const { data: existing, error: existingError } = await supabase
          .from('deal_trainings')
          .select('id')
          .eq('deal_id', associateTargetId)
          .eq('training_id', trainingToAssociate.id)
          .limit(1);
        if (existingError) throw existingError;
        if (existing && existing.length > 0) {
          addNotification('info', 'Cette formation est déjà associée à cette opportunité.');
          return;
        }

        const { error } = await supabase.from('deal_trainings').insert({
          deal_id: associateTargetId,
          training_id: trainingToAssociate.id,
        });
        if (error) throw error;
      } else {
        const { data: existing, error: existingError } = await supabase
          .from('lead_trainings')
          .select('id')
          .eq('lead_id', associateTargetId)
          .eq('training_id', trainingToAssociate.id)
          .limit(1);
        if (existingError) throw existingError;
        if (existing && existing.length > 0) {
          addNotification('info', 'Cette formation est déjà associée à ce lead.');
          return;
        }

        const { error } = await supabase.from('lead_trainings').insert({
          lead_id: associateTargetId,
          training_id: trainingToAssociate.id,
        });
        if (error) throw error;
      }

      addNotification('success', `Formation associée (${associateTargetType === 'deal' ? 'opportunité' : 'lead'}).`);
      setIsAssociateModalOpen(false);
      setTrainingToAssociate(null);
    } catch (error: any) {
      addNotification('error', `Association impossible: ${error.message}`);
    } finally {
      setIsAssociating(false);
    }
  };

  // Filtering Logic
  const filteredTrainings = trainings.filter(t => {
      // Safe checks for potentially missing fields in old data
      const targetAudience = t.target_audience || '';
      const tType = t.training_type || '';
      const tOrg = t.organization || '';
      
      const matchesSearch = t.title.toLowerCase().includes(searchTerm.toLowerCase());
      
      const matchesTarget = selectedTarget === 'all' || targetAudience === selectedTarget;
      const matchesType = selectedType === 'all' || tType === selectedType;
      const matchesOrg = selectedOrg === 'all' || tOrg === selectedOrg;

      return matchesSearch && matchesTarget && matchesType && matchesOrg;
  });

  // Calculate Unique Values for Dropdowns
  const uniqueTargets = Array.from(new Set(trainings.map(t => t.target_audience).filter(Boolean))).sort();
  const targetOptions = [
      { value: 'all', label: 'Tous publics' },
      ...uniqueTargets.map(t => ({ value: t, label: t }))
  ];

  const uniqueTypes = Array.from(new Set(trainings.map(t => t.training_type).filter(Boolean))).sort();
  const typeOptions = [
      { value: 'all', label: 'Tous types' },
      ...uniqueTypes.map(t => ({ value: t, label: t }))
  ];

  const uniqueOrgs = Array.from(new Set(trainings.map(t => t.organization).filter(Boolean))).sort();
  const orgOptions = [
      { value: 'all', label: 'Tous organismes' },
      ...uniqueOrgs.map(t => ({ value: t, label: t }))
  ];
  const getFormatIcon = (format: string) => {
      switch(format) {
          case 'Présentiel': return <Users size={14} />;
          case 'E-Learning': return <Monitor size={14} />;
          case 'Classe Virtuelle': return <Monitor size={14} />;
          default: return <GraduationCap size={14} />;
      }
  };

  return (
    <div className="ui-page">
       <SectionTitle 
        title="Catalogue de Formations" 
        subtitle="Bibliothèque de contenus certifiés DPC"
        action={
            <div className="flex gap-3">
                {canManageCatalog && (
                  <button 
                      onClick={() => setIsModalOpen(true)}
                      className="ui-btn ui-btn-primary"
                  >
                      <Plus size={16} /> Nouvelle Formation
                  </button>
                )}
            </div>
        }
       />

       <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2.5">
              <CustomSelect 
                  value={selectedTarget}
                  onChange={setSelectedTarget}
                  options={targetOptions}
                  icon={Briefcase}
                  placeholder="Public"
                  minWidth="150px"
              />
              
              <CustomSelect 
                  value={selectedType}
                  onChange={setSelectedType}
                  options={typeOptions}
                  icon={BookOpen}
                  placeholder="Type"
                  minWidth="150px"
              />

              <CustomSelect 
                  value={selectedOrg}
                  onChange={setSelectedOrg}
                  options={orgOptions}
                  icon={Building}
                  placeholder="Organisme"
                  minWidth="150px"
              />

              {(selectedTarget !== 'all' || selectedType !== 'all' || selectedOrg !== 'all') && (
                  <button 
                      onClick={() => { setSelectedTarget('all'); setSelectedType('all'); setSelectedOrg('all'); }}
                      className="ui-btn ui-btn-ghost h-9 px-3 py-0 text-xs"
                  >
                      Effacer
                  </button>
              )}

          </div>

          <div className="inline-flex rounded-md border border-zinc-200 bg-white p-1">
            <button
              onClick={() => setViewMode('grid')}
              className={`ui-focus inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium transition ${
                viewMode === 'grid' ? 'bg-zinc-900 text-white' : 'text-zinc-600 hover:bg-zinc-100'
              }`}
            >
              <LayoutGrid size={14} /> Cartes
            </button>
            <button
              onClick={() => setViewMode('table')}
              className={`ui-focus inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium transition ${
                viewMode === 'table' ? 'bg-zinc-900 text-white' : 'text-zinc-600 hover:bg-zinc-100'
              }`}
            >
              <List size={14} /> Table
            </button>
          </div>
       </div>

       <div className="relative w-full max-w-sm mb-10">
            <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
                <Search size={15} className="text-gray-400" />
            </div>
            <input 
                type="text" 
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Rechercher..." 
                className="h-10 w-full rounded-md border border-zinc-200 bg-zinc-50 px-3 pl-10 pr-4 text-sm text-zinc-900 outline-none transition focus:border-zinc-300 focus:bg-white focus-visible:shadow-[0_0_0_3px_rgba(24,24,27,0.08)]"
            />
       </div>

       {/* Catalog Grid */}
       {loading ? (
           <SectionLoader className="py-20" />
       ) : filteredTrainings.length === 0 ? (
           <div className="ui-state-box ui-state-empty flex flex-col items-center justify-center border-dashed py-24">
               <Search size={32} className="text-gray-300 mb-3" />
               <div className="ui-state-stack">
                 <p className="ui-state-title">Aucun résultat trouvé</p>
                 <p className="ui-state-text">Essayez de modifier votre recherche ou vos filtres.</p>
               </div>
               {canManageCatalog && trainings.length === 0 && (
                   <button onClick={() => setIsModalOpen(true)} className="mt-4 text-primary text-sm font-medium hover:underline">Ajouter une première formation</button>
               )}
           </div>
       ) : viewMode === 'grid' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                {filteredTrainings.map((training, idx) => (
                    <div 
                        key={training.id} 
                        onClick={() => setSelectedTraining(training)}
                        className="group bg-surface border border-border rounded-md shadow-sm hover:shadow-card hover:border-gray-300 transition-all duration-300 cursor-pointer flex flex-col h-full overflow-hidden relative micro-interaction animate-enter"
                        style={{ animationDelay: `${idx * 50}ms` }}
                    >
                        <div className="h-44 bg-gray-100 relative overflow-hidden group">
                             {training.image ? (
                                <img 
                                    src={training.image} 
                                    alt={training.title} 
                                    className="w-full h-full object-cover grayscale-[10%] group-hover:grayscale-0 transition-all duration-500"
                                />
                             ) : (
                                 <div className="w-full h-full flex items-center justify-center bg-gray-200">
                                     <ImageIcon className="text-gray-400" />
                                 </div>
                             )}
                             
                             {/* Delete Button (Visible on Hover) */}
                             {canManageCatalog && (
                                <button 
                                    onClick={(e) => handleRequestDelete(training, e)}
                                    className="absolute top-3 right-3 z-30 p-2 bg-white/90 backdrop-blur rounded-full text-zinc-400 hover:text-rose-500 shadow-sm border border-gray-100 opacity-0 group-hover:opacity-100 transition-all duration-300 transform scale-90 hover:scale-100"
                                    title="Supprimer la formation"
                                >
                                    <Trash2 size={14} strokeWidth={1.5} />
                                </button>
                             )}

                             {/* Elegant Badges Layout */}
                             <div className="absolute top-3 left-3 z-20">
                                 <span className="backdrop-blur-md bg-white/90 text-primary text-[10px] uppercase tracking-widest font-bold px-2 py-1 rounded shadow-sm border border-white/50">
                                     {training.target_audience || 'Divers'}
                                 </span>
                             </div>
                        </div>

                        <div className="p-5 flex-1 flex flex-col">
                            {/* NEW HEADER: Type aligned with Price (No background, elegant font) */}
                            <div className="flex justify-between items-start mb-3">
                                <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-100/50">
                                    {training.training_type || 'Formation'}
                                </span>
                                <span className="text-sm font-semibold text-primary tracking-tight">
                                    {training.price} €
                                </span>
                            </div>

                            <h3 className="text-base font-medium text-primary line-clamp-2 mb-4 group-hover:text-black transition-colors leading-snug">
                                {training.title}
                            </h3>
                            
                            <div className="mt-auto pt-4 border-t border-gray-50 flex items-center justify-between text-xs text-secondary">
                                <div className="flex items-center gap-1.5">
                                    {getFormatIcon(training.format)}
                                    <span>{training.format || 'Non spécifié'}</span>
                                </div>
                                <div className="text-gray-400 flex items-center gap-1 group-hover:text-primary transition-colors">
                                    Fiche technique <ChevronRight size={12} />
                                </div>
                            </div>
                        </div>
                    </div>
                ))}
        </div>
       ) : (
        <div className="overflow-x-auto rounded-md border border-border bg-white">
          <table className="ui-table min-w-[880px] text-left text-sm">
            <thead className="border-b border-border bg-zinc-50/60">
              <tr>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">Formation</th>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">Type</th>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">Public</th>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">Organisme</th>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">Format</th>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-zinc-500 text-right">Prix</th>
                {canManageCatalog ? <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-zinc-500 text-right">Actions</th> : null}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filteredTrainings.map((training) => (
                <tr
                  key={training.id}
                  className="ui-table-row cursor-pointer hover:bg-zinc-50/50"
                  onClick={() => setSelectedTraining(training)}
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-14 shrink-0 overflow-hidden rounded border border-zinc-200 bg-zinc-100">
                        {training.image ? (
                          <img src={training.image} alt={training.title} className="h-full w-full object-cover" />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center">
                            <ImageIcon size={14} className="text-zinc-400" />
                          </div>
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-primary">{training.title}</p>
                        <p className="truncate text-xs text-secondary">{training.reference || 'Sans référence'}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm text-secondary">{training.training_type || '-'}</td>
                  <td className="px-4 py-3 text-sm text-secondary">{training.target_audience || '-'}</td>
                  <td className="px-4 py-3 text-sm text-secondary">{training.organization || '-'}</td>
                  <td className="px-4 py-3 text-sm text-secondary">{training.format || '-'}</td>
                  <td className="px-4 py-3 text-right text-sm font-medium text-primary">{training.price ?? 0} €</td>
                  {canManageCatalog ? (
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={(e) => handleOpenAssociateModal(training, e)}
                          className="ui-focus rounded-md p-1.5 text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-700"
                          title="Associer cette formation"
                        >
                          <Link2 size={15} />
                        </button>
                        <button
                          onClick={(e) => handleRequestDelete(training, e)}
                          className="ui-focus rounded-md p-1.5 text-zinc-500 transition-colors hover:bg-rose-50 hover:text-rose-600"
                          title="Supprimer la formation"
                        >
                          <Trash2 size={15} />
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

       <Modal isOpen={isAssociateModalOpen} onClose={() => setIsAssociateModalOpen(false)} maxWidth="lg">
         <div className="w-full rounded-md bg-surface p-6">
           <h3 className="mb-2 text-lg font-medium text-primary">Associer une formation</h3>
           <p className="mb-5 text-sm text-secondary">
             {trainingToAssociate ? `Formation: ${trainingToAssociate.title}` : 'Sélectionnez une cible'}
           </p>

           <div className="mb-4 inline-flex w-full rounded-md border border-zinc-200 bg-white p-1">
             <button
               onClick={() => { setAssociateTargetType('lead'); setAssociateTargetId(''); }}
               className={`ui-focus flex-1 rounded px-3 py-2 text-xs font-medium transition ${associateTargetType === 'lead' ? 'bg-zinc-900 text-white' : 'text-zinc-600 hover:bg-zinc-100'}`}
             >
               Lead
             </button>
             <button
               onClick={() => { setAssociateTargetType('deal'); setAssociateTargetId(''); }}
               className={`ui-focus flex-1 rounded px-3 py-2 text-xs font-medium transition ${associateTargetType === 'deal' ? 'bg-zinc-900 text-white' : 'text-zinc-600 hover:bg-zinc-100'}`}
             >
               Opportunité
             </button>
           </div>

           <div className="mb-6">
             <label className="ui-field-label">{associateTargetType === 'lead' ? 'Lead cible' : 'Opportunité cible'}</label>
             {isLoadingAssociationTargets ? (
               <div className="ui-input flex h-10 items-center gap-2 text-sm text-secondary">
                 <Loader2 size={14} className="animate-spin" /> Chargement...
               </div>
             ) : (
               <select
                 value={associateTargetId}
                 onChange={(e) => setAssociateTargetId(e.target.value)}
                 className="ui-input"
               >
                 <option value="">Sélectionner...</option>
                 {associateTargetType === 'lead'
                   ? assignableLeads.map((lead) => (
                       <option key={lead.id} value={lead.id}>
                         {lead.name}{lead.email ? ` (${lead.email})` : ''}
                       </option>
                     ))
                   : assignableDeals.map((deal) => (
                       <option key={deal.id} value={deal.id}>
                         {deal.title}
                       </option>
                     ))}
               </select>
             )}
           </div>

           <div className="flex justify-end gap-3">
             <button onClick={() => setIsAssociateModalOpen(false)} className="ui-btn ui-btn-secondary">Annuler</button>
             <button
               onClick={handleAssociateTraining}
               disabled={isAssociating || !associateTargetId || isLoadingAssociationTargets}
               className="ui-btn ui-btn-primary"
             >
               {isAssociating ? <Loader2 size={14} className="animate-spin" /> : <Link2 size={14} />}
               Associer
             </button>
           </div>
         </div>
       </Modal>

       {/* DELETE CONFIRMATION MODAL - MONOCHROME */}
       <Modal isOpen={isDeleteModalOpen} onClose={() => setIsDeleteModalOpen(false)}>
           <div className="bg-white p-6 rounded-md max-w-sm w-full">
               <div className="flex flex-col items-center text-center">
                   {/* Monochrome Icon Container */}
                   <div className="w-12 h-12 bg-gray-50 text-primary rounded-full flex items-center justify-center mb-4 border border-gray-100">
                       <Trash2 size={22} strokeWidth={1.5} />
                   </div>
                   <h3 className="text-lg font-medium text-primary mb-2">Confirmer la suppression</h3>
                   <p className="text-sm text-secondary mb-6">
                       Êtes-vous sûr de vouloir supprimer définitivement la formation 
                       <span className="font-semibold text-primary block mt-1">"{trainingToDelete?.title}"</span> ?
                       Cette action est irréversible.
                   </p>
                   
                   <div className="flex gap-3 w-full">
                       <button 
                           onClick={() => setIsDeleteModalOpen(false)}
                           className="ui-btn ui-btn-secondary flex-1"
                       >
                           Annuler
                       </button>
                       {/* Black Primary Button */}
                       <button 
                           onClick={confirmDelete}
                           className="ui-btn ui-btn-primary flex-1"
                       >
                           Supprimer
                       </button>
                   </div>
               </div>
           </div>
       </Modal>


       {/* DETAIL SHEET (SlideOver) */}
      <SlideOver 
         isOpen={!!selectedTraining} 
         onClose={() => setSelectedTraining(null)}
         title="Fiche Technique"
       >
          {selectedTraining && (
              <div className="space-y-8 animate-fade-in">
                  {loadingTrainingDetails ? (
                    <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-500">
                      Chargement des details de la formation...
                    </div>
                  ) : null}
                  
                  {/* Section: Header Image & Title */}
                  <div className="relative h-48 rounded-md overflow-hidden mb-6 shadow-sm border border-border">
                      {selectedTraining.image && <img src={selectedTraining.image} alt="Cover" className="w-full h-full object-cover" />}
                      <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-transparent flex flex-col justify-end p-6">
                          <div className="mb-3">
                            <span className="bg-white text-primary text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded shadow-sm">
                                {selectedTraining.target_audience || 'Public cible'}
                            </span>
                          </div>
                          <h2 className="text-xl font-light text-white leading-tight">{selectedTraining.title}</h2>
                      </div>
                  </div>

                  {/* Section: Infos Générales */}
                  <div>
                      <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                          <FileText size={14} /> Informations Générales
                      </h3>
                      <div className="bg-white rounded-lg border border-border p-4 space-y-3 text-sm shadow-sm">
                          <div className="flex justify-between border-b border-gray-100 pb-2">
                              <span className="text-secondary">Référence (ID)</span>
                              <span className="font-mono text-primary bg-gray-50 px-1.5 py-0.5 rounded text-xs">{selectedTraining.reference || 'N/A'}</span>
                          </div>
                          <div className="flex justify-between border-b border-gray-100 pb-2">
                              <span className="text-secondary">Organisme</span>
                              <span className="font-medium text-primary">{selectedTraining.organization || 'N/A'}</span>
                          </div>
                          <div className="flex justify-between border-b border-gray-100 pb-2">
                              <span className="text-secondary">Statut</span>
                              <span className="text-emerald-600 font-medium flex items-center gap-1">
                                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-500"></div> {selectedTraining.status || 'Actif'}
                              </span>
                          </div>
                          <div className="flex justify-between border-b border-gray-100 pb-2">
                              <span className="text-secondary">Type</span>
                              <span className="font-medium text-primary">{selectedTraining.training_type} ({selectedTraining.format})</span>
                          </div>
                          <div className="flex justify-between">
                              <span className="text-secondary">Public cible</span>
                              <span className="font-medium text-primary text-right">{selectedTraining.target_audience}</span>
                          </div>
                      </div>
                  </div>

                  {/* Section: Données Financières et Durée */}
                  <div>
                      <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                          <Banknote size={14} /> Données Financières & Durée
                      </h3>
                      <div className="grid grid-cols-2 gap-4 text-sm">
                          <div className="bg-white border border-border p-4 rounded-lg flex flex-col justify-between shadow-sm">
                              <span className="block text-secondary text-xs uppercase tracking-wide mb-2">Prix de base</span>
                              <span className="text-2xl font-light text-primary">{selectedTraining.price} €</span>
                          </div>
                          <div className="bg-white border border-border p-4 rounded-lg flex flex-col justify-between shadow-sm">
                              <span className="block text-secondary text-xs uppercase tracking-wide mb-2">Indemnité</span>
                              <span className="text-2xl font-light text-emerald-600">{selectedTraining.compensation} €</span>
                          </div>
                          <div className="bg-white border border-border p-3 rounded-lg shadow-sm">
                              <span className="block text-secondary text-xs mb-1">Financeur</span>
                              <span className="text-base font-medium text-primary">{selectedTraining.funder || 'DPC'}</span>
                          </div>
                          <div className="bg-white border border-border p-3 rounded-lg shadow-sm">
                              <span className="block text-secondary text-xs mb-1">Durée totale</span>
                              <span className="text-base font-medium text-primary flex items-center gap-1"><Clock size={14}/> {selectedTraining.duration_total}</span>
                          </div>
                      </div>
                  </div>

                  {/* Section: Intervenant */}
                  <div>
                      <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                          <User size={14} /> Intervenant
                      </h3>
                      <div className="bg-white border border-border rounded-lg p-4 flex gap-4 shadow-sm">
                          <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center text-gray-500 font-bold text-lg border border-gray-200 shrink-0">
                              {selectedTraining.instructor_name ? selectedTraining.instructor_name.charAt(0) : '?'}
                          </div>
                          <div>
                              <h4 className="font-bold text-primary">{selectedTraining.instructor_name || 'Non renseigné'}</h4>
                              <p className="text-sm text-secondary mt-1 whitespace-pre-line leading-relaxed">{selectedTraining.instructor_bio || 'Aucune biographie disponible.'}</p>
                          </div>
                      </div>
                  </div>

                  {/* Section: Programme */}
                  <div>
                      <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                          <BookOpen size={14} /> Programme Détaillé
                      </h3>
                      <div className="prose prose-sm prose-zinc max-w-none bg-gray-50 p-4 rounded-lg border border-border whitespace-pre-line shadow-inner text-secondary">
                          {selectedTraining.program_details || 'Programme non renseigné.'}
                      </div>
                  </div>

              </div>
          )}
       </SlideOver>

       {/* Create Modal - Expanded for new fields */}
       <SlideOver isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title="Nouvelle Formation" maxWidth="xl">
                <p className="mb-5 text-sm text-secondary">Ajoutez une fiche formation structurée et lisible.</p>
                
                <div className="space-y-5">
                    {/* Block 1: Identification */}
                    <div className="space-y-3 rounded-md border border-zinc-200 bg-zinc-50/60 p-3">
                        <label className="text-xs font-semibold uppercase tracking-[0.06em] text-zinc-500">Identification</label>
                        <input 
                            type="text" 
                            value={newTraining.title}
                            onChange={(e) => setNewTraining({...newTraining, title: e.target.value})}
                            className="ui-input"
                            placeholder="Titre de la formation"
                        />
                        <div className="grid grid-cols-2 gap-3">
                            <input 
                                type="text" 
                                value={newTraining.reference}
                                onChange={(e) => setNewTraining({...newTraining, reference: e.target.value})}
                                className="ui-input"
                                placeholder="Référence (ex: REF-123)"
                            />
                            <select 
                                value={newTraining.organization}
                                onChange={(e) => setNewTraining({...newTraining, organization: e.target.value})}
                                className="ui-input"
                            >
                                <option value="WALTER">WALTER</option>
                                <option value="Autre">Autre</option>
                            </select>
                        </div>
                    </div>

                    {/* Block 2: Cible & Type */}
                    <div className="space-y-3 rounded-md border border-zinc-200 bg-zinc-50/60 p-3">
                        <label className="text-xs font-semibold uppercase tracking-[0.06em] text-zinc-500">Cible & Type</label>
                         <select 
                            value={newTraining.target_audience}
                            onChange={(e) => setNewTraining({...newTraining, target_audience: e.target.value})}
                            className="ui-input"
                        >
                            <option value="Infirmier diplômé d'État">Infirmier diplômé d'État (IDE)</option>
                            <option value="Médecin Généraliste">Médecin Généraliste</option>
                            <option value="Cardiologue">Cardiologue</option>
                            <option value="Kinésithérapeute">Kinésithérapeute</option>
                        </select>
                        <div className="grid grid-cols-2 gap-3">
                            <select 
                                value={newTraining.training_type}
                                onChange={(e) => setNewTraining({...newTraining, training_type: e.target.value})}
                                className="ui-input"
                            >
                                <option value="Formation Continue">Formation Continue (FC)</option>
                                <option value="EPP">EPP</option>
                                <option value="GDR">Gestion des Risques</option>
                            </select>
                            <select 
                                value={newTraining.format}
                                onChange={(e) => setNewTraining({...newTraining, format: e.target.value as any})}
                                className="ui-input"
                            >
                                <option value="E-Learning">E-Learning</option>
                                <option value="Présentiel">Présentiel</option>
                                <option value="Classe Virtuelle">Classe Virtuelle</option>
                                <option value="Hybride">Hybride</option>
                            </select>
                        </div>
                    </div>

                    {/* Block 3: Finance & Durée */}
                    <div className="space-y-3 rounded-md border border-zinc-200 bg-zinc-50/60 p-3">
                        <label className="text-xs font-semibold uppercase tracking-[0.06em] text-zinc-500">Finance & Durée</label>
                        <div className="grid grid-cols-3 gap-3">
                            <div>
                                <label className="text-[11px] font-medium text-secondary">Prix (€)</label>
                                <input 
                                    type="number" 
                                    value={newTraining.price}
                                    onChange={(e) => setNewTraining({...newTraining, price: Number(e.target.value)})}
                                    className="ui-input"
                                />
                            </div>
                            <div>
                                <label className="text-[11px] font-medium text-secondary">Indemnité (€)</label>
                                <input 
                                    type="number" 
                                    value={newTraining.compensation}
                                    onChange={(e) => setNewTraining({...newTraining, compensation: Number(e.target.value)})}
                                    className="ui-input"
                                />
                            </div>
                             <div>
                                <label className="text-[11px] font-medium text-secondary">Durée</label>
                                <input 
                                    type="text" 
                                    value={newTraining.duration_total}
                                    onChange={(e) => setNewTraining({...newTraining, duration_total: e.target.value})}
                                    className="ui-input"
                                    placeholder="ex: 4h"
                                />
                            </div>
                        </div>
                    </div>

                    {/* Block 4: Intervenant */}
                    <div className="space-y-3 rounded-md border border-zinc-200 bg-zinc-50/60 p-3">
                         <label className="text-xs font-semibold uppercase tracking-[0.06em] text-zinc-500">Intervenant</label>
                         <input 
                            type="text" 
                            value={newTraining.instructor_name}
                            onChange={(e) => setNewTraining({...newTraining, instructor_name: e.target.value})}
                            className="ui-input"
                            placeholder="Nom du Dr ou Formateur"
                        />
                        <textarea 
                            value={newTraining.instructor_bio}
                            onChange={(e) => setNewTraining({...newTraining, instructor_bio: e.target.value})}
                            className="ui-input h-16 resize-none"
                            placeholder="Titre, poste, parcours..."
                        />
                    </div>

                    {/* Block 5: Programme */}
                    <div className="space-y-3 rounded-md border border-zinc-200 bg-zinc-50/60 p-3">
                         <label className="text-xs font-semibold uppercase tracking-[0.06em] text-zinc-500">Programme Détaillé</label>
                         <textarea 
                            value={newTraining.program_details}
                            onChange={(e) => setNewTraining({...newTraining, program_details: e.target.value})}
                            className="ui-input h-32"
                            placeholder="Copiez-collez le programme ici (Partie I, Chapitre A...)"
                        />
                    </div>

                    <div className="flex justify-end gap-2 border-t border-zinc-200 pt-4">
                        <button 
                            onClick={() => setIsModalOpen(false)}
                            className="ui-btn ui-btn-secondary"
                        >
                            Annuler
                        </button>
                        <button 
                            onClick={handleCreateTraining}
                            disabled={isSubmitting}
                            className="ui-btn ui-btn-primary"
                        >
                            {isSubmitting && <Loader2 size={14} className="animate-spin" />}
                            Créer la fiche
                        </button>
                    </div>
                </div>
       </SlideOver>

    </div>
  );
};

export default Catalog;
