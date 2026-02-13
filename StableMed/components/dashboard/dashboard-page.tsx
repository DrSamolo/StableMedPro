"use client";

import React, { useEffect, useState } from 'react';
import { Card, CountUp, PageHeader, SectionLoader } from '@/components/Common';
import { FilterBar } from '@/components/FilterBar';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { ArrowUpRight, ArrowDownRight, Activity, DollarSign, Users, TrendingUp, Briefcase, Award, Phone } from 'lucide-react';
import { KpiData } from '@/types';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useData } from '@/contexts/DataContext';
import { fetchZadarmaCallStats } from '@/lib/integrations';
import { getCached, setCached } from '@/lib/perf/cache';
import { useSectionPerf } from '@/lib/perf/use-section-perf';

const DASHBOARD_CACHE_TTL_MS = 30_000;

const parseAmount = (value: unknown): number => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
};

const normalizeStage = (stage: unknown): string => (typeof stage === 'string' ? stage.trim().toLowerCase() : '');

const StatCard: React.FC<{ kpi: KpiData; icon: React.ReactNode; index: number }> = ({ kpi, icon, index }) => (
  <div style={{ animationDelay: `${index * 60}ms` }}>
    <Card className="h-full border-slate-200 bg-white">
        <div className="mb-3 flex items-start justify-between">
        <div className="rounded-md border border-slate-200 bg-slate-50 p-2 text-slate-600">
            {icon}
        </div>
        <div className={`flex items-center text-xs font-semibold ${kpi.trendDirection === 'up' ? 'text-emerald-600' : 'text-rose-600'}`}>
            {kpi.trend > 0 && (
                <>
                    {kpi.trendDirection === 'up' ? <ArrowUpRight size={14} className="mr-1" /> : <ArrowDownRight size={14} className="mr-1" />}
                    {kpi.trend}%
                </>
            )}
        </div>
        </div>
        <div>
        <p className="mb-1 text-[13px] font-medium text-slate-500">{kpi.label}</p>
        {/* Animated Number */}
        <CountUp 
            value={kpi.value} 
            className="text-[1.7rem] font-semibold leading-none text-primary tracking-tight" 
        />
        </div>
    </Card>
  </div>
);

const Dashboard: React.FC = () => {
  const { user, profile } = useAuth();
  const { selectedTeamId, selectedUserId, users } = useData(); // Use Global Filters
  const [loading, setLoading] = useState(true);
  useSectionPerf('dashboard', loading);
  
  // State for Real Data
  const [kpis, setKpis] = useState<KpiData[]>([
    { label: 'Chiffre d\'affaires', value: '0 €', trend: 0, trendDirection: 'up' },
    { label: 'Pipeline en cours', value: '0 €', trend: 0, trendDirection: 'up' },
    { label: 'Appels émis (Zadarma)', value: '0', trend: 0, trendDirection: 'up' },
    { label: 'Deals Gagnés', value: '0', trend: 0, trendDirection: 'up' },
  ]);
  const [chartData, setChartData] = useState<any[]>([]);
  const [activities, setActivities] = useState<any[]>([]);
  const [topTrainings, setTopTrainings] = useState<any[]>([]);
  const [topCommercials, setTopCommercials] = useState<any[]>([]);

  useEffect(() => {
    if (user) {
        fetchDashboardData();
    }
  }, [user, selectedTeamId, selectedUserId]); // Refetch when filters change

  const fetchDashboardData = async () => {
    try {
        const cacheKey = `dashboard:data:${user?.id ?? 'anon'}:${selectedTeamId}:${selectedUserId}`;
        const cached = getCached<{
            kpis: KpiData[];
            chartData: any[];
            activities: any[];
            topTrainings: any[];
            topCommercials: any[];
        }>(cacheKey, DASHBOARD_CACHE_TTL_MS);
        if (cached) {
            setKpis(cached.kpis);
            setChartData(cached.chartData);
            setActivities(cached.activities);
            setTopTrainings(cached.topTrainings);
            setTopCommercials(cached.topCommercials);
            setLoading(false);
        }

        setLoading(true);

        // 1. Fetch Basic Entities with Owner Info
        // Note: For a larger app, we would filter SQL-side. For this size, client-side filtering after RLS is fine.
        const [{ data: deals }, { data: leads }, callStats] = await Promise.all([
            supabase
                .from('deals')
                .select('id,title,amount,stage,owner_id,created_at')
                .order('created_at', { ascending: false })
                .limit(2000),
            supabase
                .from('leads')
                .select('id,name,user_id,created_at')
                .order('created_at', { ascending: false })
                .limit(500),
            fetchZadarmaCallStats(),
        ]);

        if (!deals || !leads) return;

        // 2. Apply Filters Logic
        const ownerTeamByUserId = new Map(users.map((u) => [u.id, u.team_id ?? null]));
        const filterData = (item: any) => {
            const itemOwnerId = item.user_id || item.owner_id; // Leads use user_id, Deals use owner_id
            
            // 1. Filter by User
            const matchesUser = selectedUserId === 'all' || itemOwnerId === selectedUserId;

            // 2. Filter by Team (Check if item owner belongs to selected team)
            let matchesTeam = true;
            if (selectedTeamId !== 'all') {
                matchesTeam = ownerTeamByUserId.get(itemOwnerId) === selectedTeamId;
            }

            // AND Logic
            return matchesUser && matchesTeam;
        };

        const filteredDeals = deals.filter(filterData);
        const filteredLeads = leads.filter(filterData);
        const usersById = new Map(users.map((u) => [u.id, u]));

        // --- Calculate KPIs ---
        const wonDeals = filteredDeals.filter((d) => normalizeStage(d.stage) === 'won');
        const activeDeals = filteredDeals.filter((d) => {
          const stage = normalizeStage(d.stage);
          return stage !== 'won' && stage !== 'lost';
        });

        const totalRevenue = wonDeals.reduce((acc, curr) => acc + parseAmount(curr.amount), 0);
        const pipelineValue = activeDeals.reduce((acc, curr) => acc + parseAmount(curr.amount), 0);

        setKpis([
            { label: 'Chiffre d\'affaires', value: `${totalRevenue.toLocaleString()}`, trend: 100, trendDirection: 'up' }, // Removed € for clean counting
            { label: 'Pipeline en cours', value: `${pipelineValue.toLocaleString()}`, trend: 0, trendDirection: 'up' }, // Removed € for clean counting
            { label: 'Appels émis (Zadarma)', value: callStats.calls_today.toString(), trend: callStats.trend, trendDirection: 'up' },
            { label: 'Deals Gagnés', value: wonDeals.length.toString(), trend: 0, trendDirection: 'up' },
        ]);

        // --- Chart Data ---
        const chartMap = new Map<string, number>();
        for (let i = 6; i >= 0; i--) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            chartMap.set(d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }), 0);
        }
        wonDeals.forEach(deal => {
            const date = new Date(deal.created_at).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
            if (chartMap.has(date)) {
                chartMap.set(date, (chartMap.get(date) || 0) + parseAmount(deal.amount));
            }
        });
        setChartData(Array.from(chartMap).map(([name, value]) => ({ name, value })));

        // --- Top Commercials (Filtered Scope) ---
        const commercialStats: Record<string, { name: string; count: number; revenue: number }> = {};
        filteredDeals.forEach((deal) => {
          if (normalizeStage(deal.stage) !== 'won' || !deal.owner_id) return;
          const owner = usersById.get(deal.owner_id);
          const ownerName = owner?.full_name?.trim() || owner?.email?.split('@')[0] || 'Commercial';

          if (!commercialStats[deal.owner_id]) {
            commercialStats[deal.owner_id] = { name: ownerName, count: 0, revenue: 0 };
          }

          commercialStats[deal.owner_id].count += 1;
          commercialStats[deal.owner_id].revenue += parseAmount(deal.amount);
        });
        const sortedCommercials = Object.values(commercialStats)
          .sort((a, b) => b.revenue - a.revenue)
          .slice(0, 5);
        setTopCommercials(sortedCommercials);

        // --- Recent Activity (Filtered) ---
        const recentLeads = filteredLeads.slice(0, 20).map(l => ({
            type: 'lead', id: l.id, title: l.name, subtitle: 'Nouveau prospect ajouté', time: new Date(l.created_at), icon: Users
        }));
        const recentDeals = filteredDeals.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).slice(0, 20).map(d => ({
            type: 'deal', id: d.id, title: d.title, subtitle: `Deal mis à jour: ${d.stage}`, time: new Date(d.created_at), icon: Briefcase
        }));
        const mergedActivities = [...recentLeads, ...recentDeals]
          .sort((a, b) => b.time.getTime() - a.time.getTime())
          .slice(0, 30);
        setActivities(mergedActivities);

        // Unblock the page first; load top trainings in background.
        setLoading(false);

        void (async () => {
            try {
                const scopedDealIds = filteredDeals.map((deal) => deal.id).filter(Boolean);
                if (scopedDealIds.length === 0) {
                    setTopTrainings([]);
                    setCached(cacheKey, {
                        kpis: [
                            { label: 'Chiffre d\'affaires', value: `${totalRevenue.toLocaleString()}`, trend: 100, trendDirection: 'up' },
                            { label: 'Pipeline en cours', value: `${pipelineValue.toLocaleString()}`, trend: 0, trendDirection: 'up' },
                            { label: 'Appels émis (Zadarma)', value: callStats.calls_today.toString(), trend: callStats.trend, trendDirection: 'up' },
                            { label: 'Deals Gagnés', value: wonDeals.length.toString(), trend: 0, trendDirection: 'up' },
                        ],
                        chartData: Array.from(chartMap).map(([name, value]) => ({ name, value })),
                        activities: mergedActivities,
                        topTrainings: [],
                        topCommercials: sortedCommercials,
                    });
                    return;
                }

                const { data: relations } = await supabase
                    .from('deal_trainings')
                    .select(`deal_id, training_id, training:trainings (id, title, price)`)
                    .in('deal_id', scopedDealIds.slice(0, 1000));

                if (relations) {
                    const stats: Record<string, { title: string, count: number, revenue: number }> = {};
                    relations.forEach((rel: any) => {
                        if (!rel.training) return;
                        const tId = rel.training.id;
                        if (!stats[tId]) stats[tId] = { title: rel.training.title, count: 0, revenue: 0 };
                        stats[tId].count += 1;
                        stats[tId].revenue += rel.training.price || 0;
                    });
                    const sortedStats = Object.values(stats).sort((a, b) => b.revenue - a.revenue).slice(0, 5);
                    setTopTrainings(sortedStats);
                    setCached(cacheKey, {
                        kpis: [
                            { label: 'Chiffre d\'affaires', value: `${totalRevenue.toLocaleString()}`, trend: 100, trendDirection: 'up' },
                            { label: 'Pipeline en cours', value: `${pipelineValue.toLocaleString()}`, trend: 0, trendDirection: 'up' },
                            { label: 'Appels émis (Zadarma)', value: callStats.calls_today.toString(), trend: callStats.trend, trendDirection: 'up' },
                            { label: 'Deals Gagnés', value: wonDeals.length.toString(), trend: 0, trendDirection: 'up' },
                        ],
                        chartData: Array.from(chartMap).map(([name, value]) => ({ name, value })),
                        activities: mergedActivities,
                        topTrainings: sortedStats,
                        topCommercials: sortedCommercials,
                    });
                }
            } catch (e) {
                console.warn("Could not load top trainings", e);
            }
        })();

    } catch (error) {
        console.error("Error fetching dashboard:", error);
    } finally {
        setLoading(false);
    }
  };

  const getTimeAgo = (date: Date) => {
    const seconds = Math.floor((new Date().getTime() - date.getTime()) / 1000);
    let interval = seconds / 31536000;
    if (interval > 1) return Math.floor(interval) + " an(s)";
    interval = seconds / 2592000;
    if (interval > 1) return Math.floor(interval) + " mois";
    interval = seconds / 86400;
    if (interval > 1) return Math.floor(interval) + " j";
    interval = seconds / 3600;
    if (interval > 1) return Math.floor(interval) + " h";
    return "À l'instant";
  };

  // KPI Array adjusted for correct indexing
  const kpiItems = [
      { data: kpis[0], icon: <DollarSign size={18} strokeWidth={1.5} /> },
      { data: kpis[1], icon: <Activity size={18} strokeWidth={1.5} /> },
      { data: kpis[2], icon: <Phone size={18} strokeWidth={1.5} /> },
      { data: kpis[3], icon: <TrendingUp size={18} strokeWidth={1.5} /> }
  ];
  const normalizedRole = (profile?.role ?? '').trim().toLowerCase();
  const canShowTopCommercials =
    (normalizedRole === 'admin' || normalizedRole === 'manager') && selectedUserId === 'all';
  return (
    <div className="ui-page pb-10">
      <PageHeader
        title="Vue d'ensemble"
        subtitle="Performance commerciale et activités récentes"
      />
      <div className="mb-6 max-w-3xl">
        <FilterBar />
      </div>

      <div className="mb-8 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
        {kpiItems.map((item, idx) => (
            <StatCard key={idx} kpi={item.data} icon={item.icon} index={idx} />
        ))}
      </div>

      <div className="mb-8 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2 min-h-[400px] border-slate-200">
          <div className="mb-6 flex items-center justify-between">
            <h3 className="text-[15px] font-semibold leading-6 text-slate-700">Revenus générés (7 derniers jours)</h3>
          </div>
          <div className="h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#18181B" stopOpacity={0.05}/>
                    <stop offset="95%" stopColor="#18181B" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fill: '#94a3b8', fontSize: 12}} dy={10} />
                <Tooltip 
                  contentStyle={{ backgroundColor: '#fff', border: '1px solid #E2E8F0', borderRadius: '8px', boxShadow: '0 1px 2px rgba(15, 23, 42, 0.08)' }}
                  itemStyle={{ color: '#0f172a' }}
                  cursor={{ stroke: '#E2E8F0' }}
                  formatter={(value) => [`${value} €`, 'Revenu']}
                />
                <Area type="monotone" dataKey="value" stroke="#0f172a" strokeWidth={2} fillOpacity={1} fill="url(#colorValue)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <div className="flex flex-col space-y-6">
            <Card className="h-[400px] overflow-hidden border-slate-200" noPadding>
                <div className="flex h-full min-h-0 flex-col p-6">
                <h3 className="mb-5 text-[15px] font-semibold leading-6 text-slate-700">Activités récentes</h3>
                <div className="relative h-[312px]">
                <div className="h-full space-y-5 overflow-y-scroll pr-1">
                    {loading ? (
                        <SectionLoader className="h-full" />
                    ) : activities.length === 0 ? (
                        <div className="ui-state-box ui-state-empty text-center">
                          <div className="ui-state-stack">
                            <p className="ui-state-title">Aucune activité récente</p>
                            <p className="ui-state-text">Les nouvelles actions apparaîtront ici.</p>
                          </div>
                        </div>
                    ) : (
                        activities.map((item, index) => (
                        <div 
                            key={`${item.type}-${item.id}-${index}`} 
                            className="group flex items-start gap-3"
                            style={{ animationDelay: `${index * 60}ms` }}
                        >
                            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border bg-slate-50 transition-colors duration-150 group-hover:bg-slate-100">
                                <item.icon size={14} className="text-secondary transition-colors group-hover:text-primary" />
                            </div>
                            <div>
                            <p className="text-sm font-medium leading-5 text-primary transition-colors group-hover:text-black">{item.title}</p>
                            <p className="mt-0.5 text-xs leading-5 text-secondary">{item.subtitle}</p>
                            <p className="text-[10px] text-gray-400 mt-1">{getTimeAgo(item.time)}</p>
                            </div>
                        </div>
                        ))
                    )}
                </div>
                {!loading && activities.length > 0 ? (
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-surface to-transparent" />
                ) : null}
                </div>
                </div>
            </Card>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6">
          <Card>
              <div className="mb-6 flex items-center gap-2">
                   <Award className="text-primary" size={20} />
                   <h3 className="text-[15px] font-semibold leading-6 text-slate-700">Top formations (ventes)</h3>
              </div>
              
              {topTrainings.length === 0 ? (
                   <div className="ui-state-box ui-state-empty border-dashed py-8 text-center">
                       <div className="ui-state-stack">
                         <p className="ui-state-title">{loading ? 'Calcul des performances...' : 'Classement indisponible'}</p>
                         <p className="ui-state-text">
                           {loading ? "Préparation des indicateurs." : "Pas assez de données de vente pour établir un classement."}
                         </p>
                       </div>
                   </div>
              ) : (
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {topTrainings.map((t, idx) => (
                      <div
                        key={t.title}
                        className="micro-interaction flex items-center justify-between rounded-lg border border-border bg-surface px-3 py-2.5 transition-colors hover:border-slate-300"
                        style={{ animationDelay: `${idx * 60}ms` }}
                      >
                        <div>
                          <span className={`inline-flex h-5 w-5 items-center justify-center rounded-full border text-[10px] font-semibold ${
                            idx === 0 ? 'border-amber-200 bg-amber-50 text-amber-700' :
                            idx === 1 ? 'border-slate-200 bg-slate-50 text-slate-700' :
                            idx === 2 ? 'border-orange-200 bg-orange-50 text-orange-700' :
                            'border-border bg-surface text-secondary'
                          }`}>#{idx + 1}</span>
                          <p className="mt-1.5 text-[15px] font-medium leading-5 text-primary">{t.title}</p>
                          <p className="text-xs text-secondary">{t.count} vente{t.count > 1 ? 's' : ''}</p>
                        </div>
                        <p className="text-base font-medium leading-none tabular-nums text-slate-700">{t.revenue} €</p>
                      </div>
                    ))}
                  </div>
              )}
          </Card>
      </div>

      {canShowTopCommercials ? (
        <div className="mt-6 grid grid-cols-1 gap-6">
          <Card>
            <div className="mb-6 flex items-center gap-2">
              <Users className="text-primary" size={20} />
              <h3 className="text-[15px] font-semibold leading-6 text-slate-700">Top commerciaux (ventes)</h3>
            </div>

            {topCommercials.length === 0 ? (
              <div className="ui-state-box ui-state-empty border-dashed py-8 text-center">
                <div className="ui-state-stack">
                  <p className="ui-state-title">{loading ? 'Calcul des performances...' : 'Classement indisponible'}</p>
                  <p className="ui-state-text">
                    {loading ? 'Préparation des indicateurs.' : 'Pas assez de ventes gagnées pour établir un classement.'}
                  </p>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                {topCommercials.map((c, idx) => (
                  <div
                    key={`${c.name}-${idx}`}
                    className="micro-interaction flex items-center justify-between rounded-lg border border-border bg-surface px-3 py-2.5 transition-colors hover:border-slate-300"
                    style={{ animationDelay: `${idx * 60}ms` }}
                  >
                    <div>
                      <span className={`inline-flex h-5 w-5 items-center justify-center rounded-full border text-[10px] font-semibold ${
                        idx === 0 ? 'border-amber-200 bg-amber-50 text-amber-700' :
                        idx === 1 ? 'border-slate-200 bg-slate-50 text-slate-700' :
                        idx === 2 ? 'border-orange-200 bg-orange-50 text-orange-700' :
                        'border-border bg-surface text-secondary'
                      }`}>#{idx + 1}</span>
                      <p className="mt-1.5 text-[15px] font-medium leading-5 text-primary">{c.name}</p>
                      <p className="text-xs text-secondary">{c.count} vente{c.count > 1 ? 's' : ''}</p>
                    </div>
                    <p className="text-base font-medium leading-none tabular-nums text-slate-700">{c.revenue} €</p>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      ) : null}
    </div>
  );
};

export default Dashboard;
