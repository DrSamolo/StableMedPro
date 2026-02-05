import React, { useEffect, useState } from 'react';
import { Card, SectionTitle, CountUp } from '../components/Common';
import { FilterBar } from '../components/FilterBar';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { ArrowUpRight, ArrowDownRight, Activity, DollarSign, Users, TrendingUp, Briefcase, Award, Phone } from 'lucide-react';
import { KpiData } from '../types';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { useData } from '../contexts/DataContext';
import { fetchZadarmaCallStats } from '../lib/integrations';

const StatCard: React.FC<{ kpi: KpiData; icon: React.ReactNode; index: number }> = ({ kpi, icon, index }) => (
  <div className="animate-enter" style={{ animationDelay: `${index * 100}ms` }}>
    <Card className="hover:border-gray-300 transition-colors duration-300 h-full">
        <div className="flex justify-between items-start mb-4">
        <div className="p-2 bg-gray-50 rounded-md border border-gray-100 text-gray-600">
            {icon}
        </div>
        <div className={`flex items-center text-xs font-medium ${kpi.trendDirection === 'up' ? 'text-emerald-600' : 'text-rose-500'}`}>
            {kpi.trend > 0 && (
                <>
                    {kpi.trendDirection === 'up' ? <ArrowUpRight size={14} className="mr-1" /> : <ArrowDownRight size={14} className="mr-1" />}
                    {kpi.trend}%
                </>
            )}
        </div>
        </div>
        <div>
        <p className="text-secondary text-sm font-light mb-1">{kpi.label}</p>
        {/* Animated Number */}
        <CountUp 
            value={kpi.value} 
            className="text-2xl font-medium text-primary tracking-tight" 
        />
        </div>
    </Card>
  </div>
);

const Dashboard: React.FC = () => {
  const { user } = useAuth();
  const { selectedTeamId, selectedUserId, users } = useData(); // Use Global Filters
  const [loading, setLoading] = useState(true);
  
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

  useEffect(() => {
    if (user) {
        fetchDashboardData();
    }
  }, [user, selectedTeamId, selectedUserId]); // Refetch when filters change

  const fetchDashboardData = async () => {
    try {
        setLoading(true);

        // 1. Fetch Basic Entities with Owner Info
        // Note: For a larger app, we would filter SQL-side. For this size, client-side filtering after RLS is fine.
        const { data: deals } = await supabase.from('deals').select('*');
        const { data: leads } = await supabase.from('leads').select('*').order('created_at', { ascending: false });

        if (!deals || !leads) return;

        // 2. Apply Filters Logic
        const filterData = (item: any) => {
            const itemOwnerId = item.user_id || item.owner_id; // Leads use user_id, Deals use owner_id
            
            // 1. Filter by User
            const matchesUser = selectedUserId === 'all' || itemOwnerId === selectedUserId;

            // 2. Filter by Team (Check if item owner belongs to selected team)
            let matchesTeam = true;
            if (selectedTeamId !== 'all') {
                const ownerProfile = users.find(u => u.id === itemOwnerId);
                matchesTeam = ownerProfile?.team_id === selectedTeamId;
            }

            // AND Logic
            return matchesUser && matchesTeam;
        };

        const filteredDeals = deals.filter(filterData);
        const filteredLeads = leads.filter(filterData);

        // --- Calculate KPIs ---
        const wonDeals = filteredDeals.filter(d => d.stage === 'won');
        const activeDeals = filteredDeals.filter(d => d.stage !== 'won' && d.stage !== 'lost'); 
        
        const totalRevenue = wonDeals.reduce((acc, curr) => acc + curr.amount, 0);
        const pipelineValue = activeDeals.reduce((acc, curr) => acc + curr.amount, 0);

        // --- FETCH VOIP STATS (Simulated) ---
        // In a real scenario, you'd pass the userId to filter stats by user
        const callStats = await fetchZadarmaCallStats();

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
                chartMap.set(date, (chartMap.get(date) || 0) + deal.amount);
            }
        });
        setChartData(Array.from(chartMap).map(([name, value]) => ({ name, value })));

        // --- Recent Activity (Filtered) ---
        const recentLeads = filteredLeads.slice(0, 5).map(l => ({
            type: 'lead', id: l.id, title: l.name, subtitle: 'Nouveau prospect ajouté', time: new Date(l.created_at), icon: Users
        }));
        const recentDeals = filteredDeals.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).slice(0, 5).map(d => ({
            type: 'deal', id: d.id, title: d.title, subtitle: `Deal mis à jour: ${d.stage}`, time: new Date(d.created_at), icon: Briefcase
        }));
        setActivities([...recentLeads, ...recentDeals].sort((a, b) => b.time.getTime() - a.time.getTime()).slice(0, 6));

        // --- TOP TRAININGS (Filtered by Deal ownership if needed, but usually global stats) ---
        // For simplicity, we keep global stats for now, or we'd need complex joins.
        // We'll skip strict filtering on this specific widget to avoid complexity for now.
        try {
            const { data: relations } = await supabase
                .from('deal_trainings')
                .select(`training_id, training:trainings (id, title, price)`);

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
            }
        } catch (e) {
            console.warn("Could not load top trainings", e);
        }

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

  return (
    <div className="animate-fade-in pb-10">
      <SectionTitle title="Vue d'ensemble" subtitle="Performance commerciale et activités récentes" />

      <FilterBar />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        {kpiItems.map((item, idx) => (
            <StatCard key={idx} kpi={item.data} icon={item.icon} index={idx} />
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        <Card className="lg:col-span-2 min-h-[400px] animate-enter delay-500">
          <div className="flex justify-between items-center mb-6">
            <h3 className="text-lg font-medium text-primary">Revenus générés (7 derniers jours)</h3>
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
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fill: '#a1a1aa', fontSize: 12}} dy={10} />
                <Tooltip 
                  contentStyle={{ backgroundColor: '#fff', border: '1px solid #EDEDED', borderRadius: '8px', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)' }}
                  itemStyle={{ color: '#111' }}
                  cursor={{ stroke: '#EDEDED' }}
                  formatter={(value) => [`${value} €`, 'Revenu']}
                />
                <Area type="monotone" dataKey="value" stroke="#18181B" strokeWidth={2} fillOpacity={1} fill="url(#colorValue)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <div className="space-y-6 flex flex-col animate-enter delay-700">
            <Card className="flex-1">
                <h3 className="text-lg font-medium text-primary mb-6">Activités récentes</h3>
                <div className="space-y-6">
                    {loading ? (
                        <div className="text-sm text-gray-400 text-center py-4">Chargement...</div>
                    ) : activities.length === 0 ? (
                        <div className="text-sm text-gray-400 text-center py-4">Aucune activité récente.</div>
                    ) : (
                        activities.map((item, index) => (
                        <div 
                            key={`${item.type}-${item.id}-${index}`} 
                            className="flex items-start gap-3 group animate-enter"
                            style={{ animationDelay: `${index * 100}ms` }}
                        >
                            <div className="w-8 h-8 rounded-full bg-gray-50 border border-border flex items-center justify-center shrink-0 mt-0.5 group-hover:scale-110 transition-transform duration-200">
                                <item.icon size={14} className="text-secondary group-hover:text-primary transition-colors" />
                            </div>
                            <div>
                            <p className="text-sm text-primary font-medium group-hover:text-black transition-colors">{item.title}</p>
                            <p className="text-xs text-secondary mt-0.5">{item.subtitle}</p>
                            <p className="text-[10px] text-gray-400 mt-1">{getTimeAgo(item.time)}</p>
                            </div>
                        </div>
                        ))
                    )}
                </div>
            </Card>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 animate-enter" style={{ animationDelay: '800ms' }}>
          <Card>
              <div className="flex items-center gap-2 mb-6">
                   <Award className="text-primary" size={20} />
                   <h3 className="text-lg font-medium text-primary">Top Formations (Ventes)</h3>
              </div>
              
              {topTrainings.length === 0 ? (
                   <div className="text-center py-8 text-sm text-secondary bg-gray-50 rounded-lg border border-border border-dashed">
                       {loading ? 'Calcul des performances...' : 'Pas assez de données de vente pour établir un classement.'}
                   </div>
              ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      {topTrainings.map((t, idx) => (
                          <div 
                            key={idx} 
                            className="flex items-center justify-between p-4 border border-border rounded-lg bg-surface hover:border-gray-300 transition-colors micro-interaction animate-enter"
                            style={{ animationDelay: `${idx * 100}ms` }}
                          >
                              <div className="flex items-center gap-3">
                                  <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs ${idx === 0 ? 'bg-yellow-100 text-yellow-700' : idx === 1 ? 'bg-gray-100 text-gray-700' : idx === 2 ? 'bg-orange-100 text-orange-800' : 'bg-white border border-gray-200 text-gray-500'}`}>
                                      #{idx + 1}
                                  </div>
                                  <div>
                                      <p className="text-sm font-medium text-primary line-clamp-1">{t.title}</p>
                                      <p className="text-xs text-secondary">{t.count} vente{t.count > 1 ? 's' : ''}</p>
                                  </div>
                              </div>
                              <div className="text-right">
                                  <span className="text-sm font-medium text-primary">{t.revenue} €</span>
                              </div>
                          </div>
                      ))}
                  </div>
              )}
          </Card>
      </div>
    </div>
  );
};

export default Dashboard;