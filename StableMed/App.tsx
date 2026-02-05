import React, { useState, useEffect, useRef } from 'react';
import { 
  LayoutDashboard, 
  Kanban, 
  Users, 
  ShoppingBag, 
  Settings, 
  Search, 
  Bell, 
  LogOut,
  Command,
  Loader2,
  ChevronRight,
  PanelLeftClose,
  PanelLeftOpen,
  Check,
  Info,
  AlertCircle,
  CheckCircle
} from 'lucide-react';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { NotificationProvider, useNotification } from './contexts/NotificationContext'; 
import { DataProvider } from './contexts/DataContext';
import { NotificationsContainer } from './components/Notifications'; 
import Login from './views/Login';
import Register from './views/Register';
import Dashboard from './views/Dashboard';
import Pipeline from './views/Pipeline';
import Leads from './views/Leads';
import Catalog from './views/Catalog';
import SettingsView from './views/Settings';
import { ViewState, Profile } from './types';
import { Avatar, Badge } from './components/Common';
import { supabase } from './lib/supabase';

// --- Sidebar Component ---
interface SidebarProps {
  currentView: ViewState;
  setView: (view: ViewState) => void;
  signOut: () => void;
  isCollapsed: boolean;
  toggleCollapse: () => void;
}

const Sidebar: React.FC<SidebarProps> = ({ currentView, setView, signOut, isCollapsed, toggleCollapse }) => {
  const menuItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'leads', label: 'Leads', icon: Users },
    { id: 'pipeline', label: 'Pipeline', icon: Kanban },
    { id: 'catalog', label: 'Catalogue', icon: ShoppingBag },
    { id: 'settings', label: 'Paramètres', icon: Settings },
  ];

  return (
    <div 
      className={`${isCollapsed ? 'w-20' : 'w-64'} h-screen bg-surface border-r border-border flex flex-col fixed left-0 top-0 z-20 transition-all duration-300 ease-in-out`}
    >
      <div className={`h-16 flex items-center mb-6 transition-all duration-300 ${isCollapsed ? 'justify-center px-0' : 'px-6'}`}>
        <div className="w-8 h-8 bg-primary rounded flex items-center justify-center shrink-0">
            <div className="w-4 h-4 bg-white rounded-sm opacity-90"></div>
        </div>
        <span className={`font-semibold text-primary tracking-tight text-lg ml-3 transition-opacity duration-200 whitespace-nowrap overflow-hidden ${isCollapsed ? 'opacity-0 w-0 hidden' : 'opacity-100 w-auto'}`}>
            StableMed
        </span>
      </div>

      <nav className="flex-1 px-3 space-y-1">
        {menuItems.map((item) => {
          const Icon = item.icon;
          const isActive = currentView === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setView(item.id as ViewState)}
              title={isCollapsed ? item.label : undefined}
              className={`w-full flex items-center px-3 py-2.5 rounded text-sm font-medium transition-all duration-200 ease-in-out group ${
                isActive 
                  ? 'bg-gray-100 text-primary' 
                  : 'text-secondary hover:bg-gray-50 hover:text-primary'
              } ${isCollapsed ? 'justify-center' : ''}`}
            >
              <Icon 
                size={20} 
                strokeWidth={1.5}
                className={`transition-colors shrink-0 ${isActive ? 'text-primary' : 'text-gray-400 group-hover:text-primary'} ${isCollapsed ? '' : 'mr-3'}`} 
              />
              {!isCollapsed && (
                  <span className="truncate">{item.label}</span>
              )}
            </button>
          );
        })}
      </nav>

      <div className="p-3 border-t border-border flex flex-col gap-1">
        <button 
          onClick={toggleCollapse}
          className={`flex items-center text-sm text-secondary hover:text-primary hover:bg-gray-50 transition-colors w-full px-2 py-2 rounded ${isCollapsed ? 'justify-center' : ''}`}
          title={isCollapsed ? "Agrandir le menu" : "Réduire le menu"}
        >
           {isCollapsed ? <PanelLeftOpen size={20} strokeWidth={1.5} /> : <PanelLeftClose size={20} strokeWidth={1.5} />}
           {!isCollapsed && <span className="ml-3">Réduire</span>}
        </button>

        <button 
          onClick={signOut}
          className={`flex items-center text-sm text-secondary hover:text-rose-600 hover:bg-rose-50 transition-colors w-full px-2 py-2 rounded ${isCollapsed ? 'justify-center' : ''}`}
          title="Déconnexion"
        >
          <LogOut size={20} strokeWidth={1.5} className={isCollapsed ? '' : 'mr-3'} />
          {!isCollapsed && <span>Déconnexion</span>}
        </button>
      </div>
    </div>
  );
};

// --- TopBar Component ---
interface TopBarProps {
  profile: Profile | null;
  onNavigate: (view: ViewState) => void;
  isCollapsed: boolean;
}

const TopBar: React.FC<TopBarProps> = ({ profile, onNavigate, isCollapsed }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [results, setResults] = useState<{type: 'lead' | 'deal', data: any}[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showResults, setShowResults] = useState(false);
  
  // Notification State
  const [showNotifications, setShowNotifications] = useState(false);
  const { appHistory, unreadCount, markAllAsRead, markAsRead } = useNotification();
  
  const searchRef = useRef<HTMLDivElement>(null);
  const notifRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
        setShowResults(false);
      }
      if (notifRef.current && !notifRef.current.contains(event.target as Node)) {
        setShowNotifications(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    const delayDebounceFn = setTimeout(async () => {
      if (searchQuery.length > 1) {
        setIsSearching(true);
        setShowResults(true);
        
        const [leads, deals] = await Promise.all([
            supabase.from('leads').select('*').ilike('name', `%${searchQuery}%`).limit(3),
            supabase.from('deals').select('*').ilike('title', `%${searchQuery}%`).limit(3)
        ]);

        const mappedLeads = (leads.data || []).map(l => ({ type: 'lead' as const, data: l }));
        const mappedDeals = (deals.data || []).map(d => ({ type: 'deal' as const, data: d }));
        
        setResults([...mappedLeads, ...mappedDeals]);
        setIsSearching(false);
      } else {
        setResults([]);
        setShowResults(false);
      }
    }, 300);

    return () => clearTimeout(delayDebounceFn);
  }, [searchQuery]);

  const handleResultClick = (result: {type: 'lead' | 'deal', data: any}) => {
      setSearchQuery('');
      setShowResults(false);
      if (result.type === 'lead') onNavigate('leads');
      if (result.type === 'deal') onNavigate('pipeline');
  };

  const getNotifIcon = (type: string) => {
      switch(type) {
          case 'success': return <CheckCircle size={16} className="text-emerald-500" />;
          case 'warning': return <AlertCircle size={16} className="text-orange-500" />;
          case 'alert': return <AlertCircle size={16} className="text-rose-500" />;
          default: return <Info size={16} className="text-blue-500" />;
      }
  };

  return (
    <div className={`h-16 border-b border-border bg-background/80 backdrop-blur-sm sticky top-0 z-10 flex items-center justify-between px-8 transition-all duration-300`}>
      <div className="flex items-center w-96 group relative" ref={searchRef}>
        <div className="relative w-full z-20">
            <span className="absolute inset-y-0 left-0 flex items-center pl-3">
                {isSearching ? <Loader2 size={16} className="animate-spin text-primary" /> : <Search size={16} className="text-gray-400 group-hover:text-gray-500 transition-colors" />}
            </span>
            <input 
                type="text" 
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Rechercher... (⌘K)" 
                className="w-full bg-transparent border border-transparent rounded py-1.5 pl-9 pr-4 text-sm text-primary placeholder-gray-400 focus:outline-none focus:bg-white focus:border-border focus:shadow-sm transition-all duration-200"
            />
            {!searchQuery && (
                <span className="absolute inset-y-0 right-0 flex items-center pr-3">
                    <div className="border border-gray-200 rounded px-1.5 py-0.5 text-[10px] text-gray-400 font-medium font-sans">⌘K</div>
                </span>
            )}
        </div>

        {showResults && (
            <div className="absolute top-full left-0 w-full mt-2 bg-surface border border-border rounded shadow-float overflow-hidden z-30">
                {results.length > 0 ? (
                    <div>
                        <div className="px-3 py-2 text-xs font-semibold text-gray-400 bg-gray-50/50 uppercase tracking-wider">Résultats</div>
                        {results.map((result, idx) => (
                            <div 
                                key={idx} 
                                onClick={() => handleResultClick(result)}
                                className="px-4 py-3 hover:bg-gray-50 cursor-pointer flex items-center justify-between border-b border-border last:border-0 transition-colors"
                            >
                                <div className="flex items-center gap-3">
                                    <div className={`w-8 h-8 rounded-full flex items-center justify-center ${result.type === 'lead' ? 'bg-blue-50 text-blue-600' : 'bg-emerald-50 text-emerald-600'}`}>
                                        {result.type === 'lead' ? <Users size={14} /> : <Kanban size={14} />}
                                    </div>
                                    <div>
                                        <p className="text-sm font-medium text-primary">{result.type === 'lead' ? result.data.name : result.data.title}</p>
                                        <p className="text-xs text-secondary capitalize">{result.type}</p>
                                    </div>
                                </div>
                                <ChevronRight size={14} className="text-gray-300" />
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="p-4 text-center text-sm text-secondary">
                        Aucun résultat trouvé pour "{searchQuery}"
                    </div>
                )}
            </div>
        )}
      </div>

      <div className="flex items-center gap-6">
        {/* Notification Center */}
        <div className="relative" ref={notifRef}>
            <button 
                onClick={() => setShowNotifications(!showNotifications)}
                className={`relative text-gray-400 hover:text-primary transition-colors p-1 ${showNotifications ? 'text-primary' : ''}`}
            >
                <Bell size={20} strokeWidth={1.5} />
                {unreadCount > 0 && (
                    <span className="absolute top-0.5 right-0.5 w-2 h-2 bg-blue-500 rounded-full border-2 border-white"></span>
                )}
            </button>

            {showNotifications && (
                <div className="absolute top-full right-0 mt-3 w-80 bg-white/95 backdrop-blur-md border border-gray-100 rounded-xl shadow-2xl z-50 overflow-hidden origin-top-right animate-enter">
                    <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-gray-50/50">
                        <span className="text-xs font-semibold text-primary uppercase tracking-wide">Notifications</span>
                        {unreadCount > 0 && (
                            <button onClick={markAllAsRead} className="text-[10px] text-secondary hover:text-primary hover:underline">
                                Tout marquer comme lu
                            </button>
                        )}
                    </div>
                    <div className="max-h-[320px] overflow-y-auto">
                        {appHistory.length === 0 ? (
                            <div className="py-8 text-center">
                                <p className="text-sm text-gray-400">Aucune notification.</p>
                            </div>
                        ) : (
                            appHistory.map((notif) => (
                                <div 
                                    key={notif.id} 
                                    onClick={() => markAsRead(notif.id)}
                                    className={`px-4 py-3 border-b border-gray-50 hover:bg-gray-50 transition-colors cursor-pointer flex gap-3 ${!notif.read ? 'bg-blue-50/30' : ''}`}
                                >
                                    <div className="mt-0.5 shrink-0">
                                        {getNotifIcon(notif.type)}
                                    </div>
                                    <div className="flex-1">
                                        <p className={`text-xs font-medium mb-0.5 ${!notif.read ? 'text-primary font-semibold' : 'text-gray-700'}`}>
                                            {notif.title}
                                        </p>
                                        <p className="text-[11px] text-secondary leading-snug">{notif.message}</p>
                                        <p className="text-[9px] text-gray-400 mt-1 text-right">
                                            {new Date(notif.createdAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                                        </p>
                                    </div>
                                    {!notif.read && <div className="w-1.5 h-1.5 rounded-full bg-blue-500 mt-1.5 shrink-0"></div>}
                                </div>
                            ))
                        )}
                    </div>
                </div>
            )}
        </div>

        <div className="h-6 w-px bg-border"></div>
        
        <div className="flex items-center gap-3 cursor-pointer hover:opacity-80 transition-opacity" onClick={() => onNavigate('settings')}>
          <div className="text-right hidden sm:block">
            <p className="text-sm font-medium text-primary">{profile?.full_name || profile?.email?.split('@')[0] || 'Utilisateur'}</p>
            <p className="text-xs text-secondary">En ligne</p>
          </div>
          <Avatar name={profile?.full_name || profile?.email || 'User'} src={profile?.avatar_url} />
        </div>
      </div>
    </div>
  );
};

// --- Main App Content Wrapper ---
const AppContent: React.FC = () => {
  const { session, profile, loading, signOut } = useAuth();
  const [currentView, setCurrentView] = useState<ViewState>('dashboard');
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  
  // Persist sidebar state
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() => {
    return localStorage.getItem('sidebarCollapsed') === 'true';
  });

  const toggleSidebar = () => {
      const newState = !isSidebarCollapsed;
      setIsSidebarCollapsed(newState);
      localStorage.setItem('sidebarCollapsed', String(newState));
  };

  // Check URL for invite token on load
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');
    if (token) {
        setInviteToken(token);
    }
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
        if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
            e.preventDefault();
            const input = document.querySelector('input[placeholder*="Rechercher"]') as HTMLInputElement;
            if (input) input.focus();
        }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center">
            <div className="w-8 h-8 bg-primary rounded animate-spin mb-4"></div>
            <span className="text-sm text-secondary">Chargement de StableMed...</span>
        </div>
      </div>
    );
  }

  // --- SPECIAL ROUTE: REGISTRATION ---
  if (inviteToken && !session) {
      return <Register token={inviteToken} />;
  }

  if (!session) {
    return <Login />;
  }

  const renderContent = () => {
    switch (currentView) {
      case 'dashboard':
        return <Dashboard />;
      case 'pipeline':
        return <Pipeline />;
      case 'leads':
        return <Leads />;
      case 'catalog':
        return <Catalog />;
      case 'settings':
        return <SettingsView />;
      default:
        return (
          <div className="flex items-center justify-center h-[70vh] text-secondary">
             <div className="text-center">
                <p className="mb-2">Module en développement</p>
                <p className="text-xs text-gray-400">Cette section sera disponible prochainement.</p>
             </div>
          </div>
        );
    }
  };

  return (
    <div className="flex min-h-screen bg-background text-primary font-sans selection:bg-gray-200">
      <NotificationsContainer />
      <Sidebar 
        currentView={currentView} 
        setView={setCurrentView} 
        signOut={signOut} 
        isCollapsed={isSidebarCollapsed}
        toggleCollapse={toggleSidebar}
      />
      
      <main 
        className={`flex-1 flex flex-col min-w-0 transition-all duration-300 ease-in-out ${isSidebarCollapsed ? 'ml-20' : 'ml-64'}`}
      >
        <TopBar 
            profile={profile} 
            onNavigate={setCurrentView} 
            isCollapsed={isSidebarCollapsed}
        />
        <div className="flex-1 p-8 overflow-y-auto">
          {renderContent()}
        </div>
      </main>
    </div>
  );
};

// --- Root App Component ---
const App: React.FC = () => {
  return (
    <AuthProvider>
      <NotificationProvider>
        <DataProvider>
            <AppContent />
        </DataProvider>
      </NotificationProvider>
    </AuthProvider>
  );
};

export default App;