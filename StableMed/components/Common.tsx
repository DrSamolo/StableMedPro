import React, { useEffect, useState, useRef } from 'react';
import { X, ChevronDown, Check } from 'lucide-react';

interface CardProps {
  children: React.ReactNode;
  className?: string;
  noPadding?: boolean;
  hoverable?: boolean; // New prop for explicit interaction
}

export const Card: React.FC<CardProps> = ({ children, className = '', noPadding = false, hoverable = false }) => {
  // If hoverable is true or if className doesn't explicitly disable pointer events, we add micro-interactions
  const interactionClass = hoverable || className.includes('cursor-pointer') ? 'micro-interaction' : '';

  return (
    <div className={`bg-surface border border-border rounded-xl shadow-sm transition-all duration-300 ${interactionClass} ${className}`}>
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
    neutral: 'bg-gray-50 text-gray-600 border-gray-200',
    success: 'bg-emerald-50 text-emerald-700 border-emerald-100', 
    warning: 'bg-orange-50 text-orange-700 border-orange-100', 
    blue: 'bg-sky-50 text-sky-700 border-sky-100',
    purple: 'bg-violet-50 text-violet-700 border-violet-100',
  };

  return (
    <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-medium border uppercase tracking-wider ${styles[variant]} transition-colors duration-200 ${className}`}>
      {children}
    </span>
  );
};

export const SectionTitle: React.FC<{ title: string; subtitle?: string; action?: React.ReactNode }> = ({ title, subtitle, action }) => (
  <div className="mb-8 flex justify-between items-end animate-enter delay-0">
    <div>
      <h1 className="text-2xl font-semibold text-primary tracking-tight">{title}</h1>
      {subtitle && <p className="text-secondary mt-1 font-light text-sm">{subtitle}</p>}
    </div>
    {action && <div>{action}</div>}
  </div>
);

export const Avatar: React.FC<{ name: string; src?: string | null; size?: 'sm' | 'md' | 'lg' }> = ({ name, src, size = 'md' }) => {
  const initials = (name || 'U').split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
  
  const sizeClasses = {
    sm: 'w-7 h-7 text-[10px]',
    md: 'w-9 h-9 text-xs',
    lg: 'w-12 h-12 text-sm'
  };
  
  if (src) {
      return (
          <div className={`${sizeClasses[size]} rounded-full bg-gray-100 border border-gray-200 overflow-hidden shrink-0`}>
              <img src={src} alt={name} className="w-full h-full object-cover" />
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
  const numericValue = typeof value === 'string' ? parseFloat(value.replace(/[^0-9.-]+/g, "")) : value;
  const isCurrency = typeof value === 'string' && value.includes('€');
  const isPercentage = typeof value === 'string' && value.includes('%');

  useEffect(() => {
    let startTime: number | null = null;
    const startValue = 0;
    
    // If invalid number, just show the original string immediately
    if (isNaN(numericValue)) {
        setDisplayValue(0); 
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
  const isSelected = value !== 'all' && value !== '';

  return (
    <div className={`relative ${className}`} ref={containerRef} style={{ minWidth }}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={`w-full flex items-center justify-between gap-3 px-3 py-2 bg-white border rounded-lg text-sm transition-all duration-200 shadow-sm hover:border-gray-300 hover:bg-gray-50/50 ${isOpen ? 'border-gray-400 ring-2 ring-gray-100' : 'border-gray-200'} `}
      >
        <div className="flex items-center gap-2.5 truncate">
          {Icon && <Icon size={15} className={`shrink-0 ${isSelected ? 'text-primary' : 'text-gray-400'}`} />}
          <span className={`truncate text-[13px] font-medium ${isSelected ? 'text-primary' : 'text-secondary'}`}>
            {selectedLabel}
          </span>
        </div>
        <ChevronDown size={14} className={`text-gray-400 transition-transform duration-200 shrink-0 ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="absolute top-[calc(100%+6px)] left-0 w-full min-w-[200px] bg-white border border-gray-100 rounded-lg shadow-xl z-50 animate-in fade-in zoom-in-95 duration-150 overflow-hidden py-1">
          <div className="max-h-60 overflow-y-auto">
            {options.map((option) => (
              <button
                key={option.value}
                onClick={() => {
                  onChange(option.value);
                  setIsOpen(false);
                }}
                className={`w-full text-left px-3 py-2 text-[13px] flex items-center justify-between transition-colors ${value === option.value ? 'bg-gray-50 text-primary font-medium' : 'text-secondary hover:bg-gray-50 hover:text-primary'}`}
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
}

export const SlideOver: React.FC<SlideOverProps> = ({ isOpen, onClose, title, children }) => {
  const [visible, setVisible] = useState(isOpen);

  useEffect(() => {
    if (isOpen) setVisible(true);
    else setTimeout(() => setVisible(false), 500); // Increased to match new duration
  }, [isOpen]);

  if (!visible && !isOpen) return null;

  return (
    <div className="fixed inset-0 overflow-hidden z-50">
      <div className="absolute inset-0 overflow-hidden">
        {/* Backdrop with Blur */}
        <div 
          className={`absolute inset-0 bg-gray-900/20 backdrop-blur-sm transition-opacity ease-sweet duration-500 ${isOpen ? 'opacity-100' : 'opacity-0'}`} 
          onClick={onClose}
        />
        
        {/* Panel Slide In - Using 'ease-sweet' custom bezier */}
        <div className={`pointer-events-none fixed inset-y-0 right-0 flex max-w-full pl-10 transform transition-transform ease-sweet duration-500 ${isOpen ? 'translate-x-0' : 'translate-x-full'}`}>
          <div className="pointer-events-auto w-screen max-w-md">
            <div className="flex h-full flex-col overflow-y-scroll bg-surface shadow-2xl border-l border-border">
              <div className="px-6 py-6 border-b border-border bg-gray-50/50 flex items-center justify-between">
                <h2 className="text-lg font-medium text-primary">{title}</h2>
                <button 
                  type="button" 
                  className="rounded text-gray-400 hover:text-gray-500 focus:outline-none hover:bg-gray-100 p-1 transition-colors"
                  onClick={onClose}
                >
                  <X size={20} strokeWidth={1.5} />
                </button>
              </div>
              <div className="relative mt-6 flex-1 px-4 sm:px-6 pb-6">
                {children}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
}

export const Modal: React.FC<ModalProps> = ({ isOpen, onClose, children }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex min-h-screen items-center justify-center p-4 text-center sm:p-0">
        {/* Backdrop with Blur */}
        <div 
            className="fixed inset-0 bg-gray-900/20 backdrop-blur-sm transition-opacity ease-sweet duration-300 animate-in fade-in" 
            onClick={onClose}
        ></div>
        
        {/* Content with Zoom/Fade Entry */}
        <div className="relative transform overflow-hidden rounded-xl bg-white text-left shadow-2xl transition-all sm:my-8 sm:w-full sm:max-w-sm border border-gray-100 animate-enter">
            {children}
        </div>
      </div>
    </div>
  );
};