import React, { useEffect, useState, useRef } from 'react';
import { createPortal } from "react-dom";
import { X, ChevronDown, Check } from 'lucide-react';

interface CardProps {
  children: React.ReactNode;
  className?: string;
  noPadding?: boolean;
  hoverable?: boolean; // New prop for explicit interaction
}

export const BrandMark: React.FC<{ className?: string }> = ({ className = "" }) => (
  <div className={`flex h-8 w-8 items-center justify-center rounded-md bg-zinc-900 ${className}`}>
    <div className="h-4 w-4 rounded-sm bg-white" />
  </div>
);

export const BrandLockup: React.FC<{ className?: string; compact?: boolean }> = ({ className = "", compact = false }) => (
  <div className={`flex items-center gap-3 ${className}`}>
    <BrandMark />
    {!compact ? <span className="text-lg font-semibold tracking-tight text-primary">SudMed CRM</span> : null}
  </div>
);

export const SectionLoader: React.FC<{
  title?: string;
  subtitle?: string;
  className?: string;
  delayMs?: number;
}> = ({
  title = "Chargement...",
  subtitle = "Mise a jour des donnees en cours.",
  className = "",
  delayMs = 180,
}) => {
  const [isVisible, setIsVisible] = useState(delayMs <= 0);

  useEffect(() => {
    if (delayMs <= 0) {
      setIsVisible(true);
      return;
    }

    const timer = setTimeout(() => setIsVisible(true), delayMs);
    return () => clearTimeout(timer);
  }, [delayMs]);

  if (!isVisible) return null;

  return (
    <div className={`relative overflow-hidden rounded-md border border-zinc-200/80 bg-zinc-100/35 text-zinc-600 ${className}`}>
      <div className="absolute inset-0 bg-zinc-100/30 backdrop-blur-md" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,0.55),rgba(255,255,255,0.05)_55%)]" />
      <div className="relative z-[1] flex flex-col items-center justify-center py-9 text-center">
        <BrandMark className="h-9 w-9 animate-[spin_1.15s_linear_infinite] shadow-sm" />
        <div className="mt-2.5 space-y-1">
          <p className="ui-state-title">{title}</p>
          <p className="ui-state-text">{subtitle}</p>
        </div>
      </div>
    </div>
  );
};

export const Card: React.FC<CardProps> = ({ children, className = '', noPadding = false, hoverable = false }) => {
  // If hoverable is true or if className doesn't explicitly disable pointer events, we add micro-interactions
  const interactionClass = hoverable || className.includes('cursor-pointer') ? 'micro-interaction' : '';

  return (
    <div className={`bg-surface border border-border rounded-md shadow-subtle transition-colors duration-150 motion-fade-up ${interactionClass} ${className}`}>
      <div className={noPadding ? '' : 'p-6'}>
        {children}
      </div>
    </div>
  );
};

interface BadgeProps {
  children: React.ReactNode;
  variant?: 'neutral' | 'success' | 'warning' | 'blue' | 'purple';
  className?: string;
}

export const Badge: React.FC<BadgeProps> = ({ children, variant = 'neutral', className = '' }) => {
  const styles = {
    neutral: 'bg-slate-50 text-slate-600 border-slate-200',
    success: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    warning: 'bg-amber-50 text-amber-700 border-amber-200',
    blue: 'bg-slate-100 text-slate-700 border-slate-200',
    purple: 'bg-violet-50 text-violet-700 border-violet-200',
  };

  return (
    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${styles[variant]} transition-colors duration-150 ${className}`}>
      {children}
    </span>
  );
};

export const SectionTitle: React.FC<{ title: string; subtitle?: string; action?: React.ReactNode }> = ({ title, subtitle, action }) => (
  <div className="mb-8 flex flex-wrap items-end justify-between gap-3">
    <div>
      <h1 className="text-2xl font-semibold leading-tight text-primary tracking-tight">{title}</h1>
      {subtitle && <p className="mt-1.5 text-[15px] leading-6 text-secondary">{subtitle}</p>}
    </div>
    {action && <div>{action}</div>}
  </div>
);

export const PageHeader: React.FC<{
  title: string;
  subtitle?: string;
  meta?: string;
  action?: React.ReactNode;
}> = ({ title, subtitle, meta, action }) => (
  <div className="mb-7 border-b border-border pb-5">
    <div className="mb-2 flex flex-wrap items-start justify-between gap-3">
      <div>
        {meta ? <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">{meta}</p> : null}
        <h1 className="text-[1.75rem] font-semibold leading-tight tracking-tight text-primary">{title}</h1>
      </div>
      {action ? <div className="flex items-center gap-2">{action}</div> : null}
    </div>
    {subtitle ? <p className="max-w-3xl text-[15px] leading-6 text-secondary">{subtitle}</p> : null}
  </div>
);

export const DataToolbar: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = "" }) => (
  <div className={`mb-5 rounded-md border border-border bg-surface px-3 py-2.5 shadow-subtle ${className}`}>
    {children}
  </div>
);

export const Avatar: React.FC<{ name: string; src?: string | null; size?: 'sm' | 'md' | 'lg' }> = ({ name, src, size = 'md' }) => {
  const initials = (name || 'U').split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
  
  const sizeClasses = {
    sm: 'w-7 h-7 text-[10px]',
    md: 'w-9 h-9 text-xs',
    lg: 'w-12 h-12 text-sm'
  };
  
  const normalizedSrc = (() => {
    if (!src) return null;
    if (src.startsWith("http://") || src.startsWith("https://") || src.startsWith("data:") || src.startsWith("blob:")) {
      return src;
    }
    const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!baseUrl) return src;

    if (src.startsWith("/storage/v1/object/public/") || src.startsWith("storage/v1/object/public/")) {
      const normalizedPath = src.startsWith("/") ? src : `/${src}`;
      return `${baseUrl}${normalizedPath}`;
    }

    if (src.startsWith("/")) {
      return `${baseUrl}${src}`;
    }

    const objectPath = src.replace(/^avatars\//, "");
    return `${baseUrl}/storage/v1/object/public/avatars/${objectPath}`;
  })();

  if (normalizedSrc) {
      return (
          <div className={`${sizeClasses[size]} relative rounded-full bg-gray-100 border border-gray-200 overflow-hidden shrink-0`}>
              <div className="absolute inset-0 flex items-center justify-center bg-gray-50 text-gray-600 font-medium tracking-tight">
                {initials}
              </div>
              <img
                src={normalizedSrc}
                alt={name}
                className="relative z-[1] h-full w-full object-cover"
                onError={(event) => {
                  event.currentTarget.style.display = "none";
                }}
              />
          </div>
      );
  }
  
  return (
    <div className={`${sizeClasses[size]} rounded-full bg-gray-50 text-gray-600 flex items-center justify-center border border-gray-200 font-medium tracking-tight shrink-0 select-none`}>
      {initials}
    </div>
  );
};

// --- New Components ---

// KPI Number Counter
export const CountUp: React.FC<{ value: string | number; duration?: number; className?: string }> = ({ value, duration = 1000, className = '' }) => {
  const [displayValue, setDisplayValue] = useState(0);
  const parseLocalizedValue = (raw: string) => {
    const normalized = raw
      .replace(/\u00A0/g, ' ')
      .trim()
      .replace(/[€%]/g, '')
      .replace(/\s+/g, '')
      .replace(/,/g, '.');
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : NaN;
  };
  const numericValue = typeof value === 'string' ? parseLocalizedValue(value) : value;
  const isCurrency = typeof value === 'string' && value.includes('€');
  const isPercentage = typeof value === 'string' && value.includes('%');

  useEffect(() => {
    let startTime: number | null = null;
    const startValue = 0;
    
    if (isNaN(numericValue)) {
        return;
    }

    const step = (timestamp: number) => {
      if (!startTime) startTime = timestamp;
      const progress = Math.min((timestamp - startTime) / duration, 1);
      
      // EaseOutExpo function for the numbers
      const ease = progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress);
      
      const current = Math.floor(ease * (numericValue - startValue) + startValue);
      setDisplayValue(current);

      if (progress < 1) {
        window.requestAnimationFrame(step);
      }
    };

    window.requestAnimationFrame(step);
  }, [numericValue, duration]);

  if (isNaN(numericValue)) return <span className={className}>{value}</span>;

  let formatted = displayValue.toLocaleString('fr-FR');
  if (isCurrency) formatted += ' €';
  if (isPercentage) formatted += '%';

  return <span className={className}>{formatted}</span>;
};

interface CustomSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  icon?: React.ElementType;
  placeholder?: string;
  className?: string;
  minWidth?: string;
}

export const CustomSelect: React.FC<CustomSelectProps> = ({ 
  value, 
  onChange, 
  options, 
  icon: Icon, 
  placeholder = 'Sélectionner',
  className = '',
  minWidth = '160px'
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const selectedLabel = options.find(o => o.value === value)?.label || placeholder;

  return (
    <div className={`relative ${className}`} ref={containerRef} style={{ minWidth }}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={`ui-focus motion-soft-hover flex h-9 w-full items-center justify-between gap-3 rounded-md border bg-white px-3 text-sm font-medium transition-colors duration-150 hover:border-zinc-300 hover:bg-zinc-100 ${isOpen ? 'border-zinc-300 bg-zinc-100' : 'border-zinc-200'} `}
      >
        <div className="flex items-center gap-2.5 truncate">
          {Icon && <Icon size={15} className="shrink-0 text-zinc-400" />}
          <span className="truncate text-sm text-zinc-600">
            {selectedLabel}
          </span>
        </div>
        <ChevronDown size={14} className={`shrink-0 text-zinc-400 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="motion-scale-in absolute left-0 top-[calc(100%+6px)] z-50 w-full min-w-[200px] overflow-hidden rounded-md border border-zinc-200 bg-white py-1 shadow-subtle">
          <div className="max-h-60 overflow-y-auto">
            {options.map((option) => (
              <button
                key={option.value}
                onClick={() => {
                  onChange(option.value);
                  setIsOpen(false);
                }}
                className={`ui-focus flex w-full items-center justify-between px-3 py-2 text-left text-[13px] transition-colors ${value === option.value ? 'bg-zinc-50 text-primary font-medium' : 'text-secondary hover:bg-zinc-50 hover:text-primary'}`}
              >
                <span className="truncate">{option.label}</span>
                {value === option.value && <Check size={14} className="text-black" />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

interface SlideOverProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  maxWidth?: "md" | "lg" | "xl" | "2xl";
}

export const SlideOver: React.FC<SlideOverProps> = ({ isOpen, onClose, title, children, maxWidth = "md" }) => {
  const [visible, setVisible] = useState(isOpen);
  const [mounted, setMounted] = useState(false);
  const widthClass = {
    md: "max-w-md",
    lg: "max-w-lg",
    xl: "max-w-xl",
    "2xl": "max-w-2xl",
  }[maxWidth];

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (isOpen) {
      const showTimer = window.setTimeout(() => setVisible(true), 0);
      return () => window.clearTimeout(showTimer);
    }

    const hideTimer = window.setTimeout(() => setVisible(false), 500);
    return () => window.clearTimeout(hideTimer);
  }, [isOpen]);

  if (!mounted || (!visible && !isOpen)) return null;

  return createPortal(
    <div className="fixed inset-0 overflow-hidden z-[110] motion-page-enter">
      <div className="absolute inset-0 overflow-hidden">
        {/* Backdrop with Blur */}
        <div
          className={`absolute inset-0 bg-slate-900/10 backdrop-blur-sm transition-opacity ease-sweet duration-300 ${isOpen ? 'opacity-100' : 'opacity-0'}`}
          onClick={onClose}
        />
        
        {/* Panel Slide In - Using 'ease-sweet' custom bezier */}
        <div className={`pointer-events-none fixed inset-y-0 right-0 flex max-w-full transform transition-transform ease-sweet duration-300 ${isOpen ? 'translate-x-0' : 'translate-x-full'}`}>
          <div className={`pointer-events-auto w-screen ${widthClass}`}>
            <div className="flex h-full flex-col overflow-hidden border-l border-border bg-surface shadow-float">
              <div className="sticky top-0 z-10 flex shrink-0 items-center justify-between border-b border-border bg-zinc-50/95 px-6 py-5 backdrop-blur-sm">
                <h2 className="text-lg font-medium text-primary">{title}</h2>
                <button 
                  type="button" 
                  className="ui-focus rounded-sm p-1 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-500"
                  onClick={onClose}
                >
                  <X size={20} strokeWidth={1.5} />
                </button>
              </div>
              <div className="relative mt-6 flex-1 overflow-y-auto px-4 pb-6 sm:px-6">
                {children}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
  maxWidth?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl' | '4xl';
  contentScroll?: boolean;
}

export const Modal: React.FC<ModalProps> = ({ isOpen, onClose, children, maxWidth = 'sm', contentScroll = true }) => {
  const [mounted, setMounted] = useState(false);
  const maxWidthClass = {
    sm: 'sm:max-w-sm',
    md: 'sm:max-w-md',
    lg: 'sm:max-w-lg',
    xl: 'sm:max-w-xl',
    '2xl': 'sm:max-w-2xl',
    '3xl': 'sm:max-w-3xl',
    '4xl': 'sm:max-w-4xl',
  }[maxWidth];

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen]);

  if (!mounted || !isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-[120] overflow-y-auto motion-page-enter">
      <div className="flex min-h-dvh items-start justify-center p-4 text-center sm:items-center sm:p-6">
        {/* Backdrop with Blur */}
        <div
            className="fixed inset-0 bg-slate-900/25 transition-opacity ease-sweet duration-200"
            onClick={onClose}
        ></div>
        
        {/* Content with Zoom/Fade Entry + viewport-safe scrolling */}
        <div className={`relative mt-8 max-h-[calc(100dvh-2rem)] w-full transform rounded-lg border border-zinc-200 bg-white text-left shadow-card transition-all sm:mt-0 sm:my-8 ${contentScroll ? 'overflow-y-auto' : 'overflow-visible'} ${maxWidthClass} motion-scale-in`}>
            {children}
        </div>
      </div>
    </div>,
    document.body
  );
};
