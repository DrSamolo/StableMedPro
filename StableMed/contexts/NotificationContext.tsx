import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { AppNotification } from '../types';

export type NotificationType = 'success' | 'error' | 'info' | 'warning';

export interface Toast {
  id: string;
  type: NotificationType;
  message: string;
}

interface NotificationContextType {
  // Toasts (Ephemeral)
  notifications: Toast[]; 
  addNotification: (type: NotificationType, message: string) => void;
  removeNotification: (id: string) => void;
  
  // App History (Persistent in session)
  appHistory: AppNotification[];
  unreadCount: number;
  pushAppNotification: (title: string, message: string, type: AppNotification['type']) => void;
  markAsRead: (id: string) => void;
  markAllAsRead: () => void;
}

const NotificationContext = createContext<NotificationContextType>({
  notifications: [],
  addNotification: () => {},
  removeNotification: () => {},
  appHistory: [],
  unreadCount: 0,
  pushAppNotification: () => {},
  markAsRead: () => {},
  markAllAsRead: () => {},
});

export const NotificationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // Toast State
  const [notifications, setNotifications] = useState<Toast[]>([]);
  
  // App History State
  const [appHistory, setAppHistory] = useState<AppNotification[]>([]);

  // Initialize Fake Data for UI Demonstration
  useEffect(() => {
      setAppHistory([
          { id: '1', title: 'Nouvelle fonctionnalité', message: 'Le module "Diagnostic" est disponible dans les paramètres.', type: 'info', read: false, createdAt: new Date(Date.now() - 3600000) },
          { id: '2', title: 'Lead qualifié', message: 'Jean Dupont a été marqué comme "Qualifié".', type: 'success', read: false, createdAt: new Date(Date.now() - 7200000) },
          { id: '3', title: 'Rappel Système', message: 'Pensez à mettre à jour vos KPIs de la semaine.', type: 'warning', read: true, createdAt: new Date(Date.now() - 86400000) },
      ]);
  }, []);

  // --- Toast Logic ---
  const removeNotification = useCallback((id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  }, []);

  const addNotification = useCallback((type: NotificationType, message: string) => {
    const id = Math.random().toString(36).substring(2, 9);
    setNotifications((prev) => [...prev, { id, type, message }]);
    setTimeout(() => removeNotification(id), 5000);
  }, [removeNotification]);

  // --- App History Logic ---
  const pushAppNotification = useCallback((title: string, message: string, type: AppNotification['type'] = 'info') => {
      const newNotif: AppNotification = {
          id: Math.random().toString(36).substring(2, 9),
          title,
          message,
          type,
          read: false,
          createdAt: new Date()
      };
      setAppHistory(prev => [newNotif, ...prev]);
  }, []);

  const markAsRead = useCallback((id: string) => {
      setAppHistory(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
  }, []);

  const markAllAsRead = useCallback(() => {
      setAppHistory(prev => prev.map(n => ({ ...n, read: true })));
  }, []);

  const unreadCount = appHistory.filter(n => !n.read).length;

  return (
    <NotificationContext.Provider value={{ 
        notifications, 
        addNotification, 
        removeNotification,
        appHistory,
        unreadCount,
        pushAppNotification,
        markAsRead,
        markAllAsRead
    }}>
      {children}
    </NotificationContext.Provider>
  );
};

export const useNotification = () => useContext(NotificationContext);