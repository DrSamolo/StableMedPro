import React from 'react';
import { X, CheckCircle, AlertCircle, Info, AlertTriangle } from 'lucide-react';
import { useNotification, NotificationType } from '../contexts/NotificationContext';

const icons: Record<NotificationType, React.ReactNode> = {
  success: <CheckCircle size={20} className="text-emerald-500" />,
  error: <AlertCircle size={20} className="text-rose-500" />,
  info: <Info size={20} className="text-zinc-500" />,
  warning: <AlertTriangle size={20} className="text-orange-500" />,
};

const styles: Record<NotificationType, string> = {
  success: 'bg-white border-emerald-100',
  error: 'bg-white border-rose-100',
  info: 'bg-white border-zinc-200',
  warning: 'bg-white border-orange-100',
};

export const NotificationsContainer: React.FC = () => {
  const { notifications, removeNotification } = useNotification();

  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-3 w-full max-w-sm pointer-events-none">
      {notifications.map((notification) => (
        <div
          key={notification.id}
          className={`pointer-events-auto motion-toast-enter motion-soft-hover flex items-start gap-3 rounded-lg border p-4 shadow-float ${styles[notification.type]}`}
        >
          <div className="shrink-0 mt-0.5">{icons[notification.type]}</div>
          <div className="flex-1 pt-0.5">
            <p className="text-sm font-medium text-gray-900">{notification.message}</p>
          </div>
          <button
            onClick={() => removeNotification(notification.id)}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X size={16} />
          </button>
        </div>
      ))}
    </div>
  );
};
