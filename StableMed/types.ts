
export type ViewState = 'dashboard' | 'tasks' | 'leads' | 'pipeline' | 'sales' | 'catalog' | 'settings' | 'register';

export type UserRole = 'admin' | 'manager' | 'commercial' | 'representant';

export interface Team {
  id: string;
  name: string;
  created_at: string;
}

export interface Invitation {
    id: string;
    email: string;
    role: UserRole;
    team_id?: string;
    organization_scopes?: string[] | null;
    token: string;
    expires_at: string;
    created_at: string;
    created_by: string;
}

export interface Profile {
  id: string;
  email: string;
  full_name: string;
  avatar_url?: string;
  role: UserRole;
  manager_id?: string;
  team_id?: string; // New Field
  created_at: string;
  team?: Team; // Optional joined data
}

export interface RolePermission {
  role: UserRole;
  permissions: {
    can_manage_team: boolean;
    can_delete_leads: boolean;
    can_export_data: boolean;
    can_manage_roles: boolean;
    can_manage_catalog: boolean;
    [key: string]: boolean;
  };
}

export interface AppNotification {
  id: string;
  userId?: string; // Target user (if null, global or role based logic handles it)
  title: string;
  message: string;
  type: 'info' | 'success' | 'warning' | 'alert';
  read: boolean;
  createdAt: Date;
}

export interface Lead {
  id: string;
  user_id?: string; // Owner ID
  assignee?: Profile; // Owner Profile (Joined)
  
  // Basic Display
  name: string; 

  // Detailed Info
  first_name?: string;
  last_name?: string;
  profession?: string;
  client_reference?: string;
  address?: string;
  secure_info?: string; // Mdp/Andpc
  
  specialty: string; // Legacy/Mapped
  location: string;
  status: 'new' | 'contacted' | 'qualified' | 'won' | 'closed' | 'lost';
  is_pipeline: boolean;
  lastActivity: string; // Dans la DB c'est last_activity
  email: string;
  phone?: string;
}

export interface Deal {
  id: string;
  lead_id?: string;
  leadName: string;
  training: string; // Legacy field (single string)
  trainings?: Training[]; // New field (multiple trainings)
  amount: number;
  stage: 'new' | 'negotiation' | 'closing' | 'won' | 'lost';
  probability: number;
  owner: string; // Display name
  owner_id?: string; // UUID
  assignee?: Profile; // Joined Profile
  closed_at?: string; // Date de closing
}

export interface KpiData {
  label: string;
  value: string;
  trend: number; // percentage
  trendDirection: 'up' | 'down';
}

export interface Training {
  id: string;
  title: string;
  reference: string;
  organization: string;
  status: 'Actif' | 'Inactif' | 'Archivé';
  training_type: string; // ex: Formation Continue, EPP, GDR
  target_audience: string; // ex: Infirmier, Cardiologue
  price: number;
  compensation: number; // Indemnité
  funder: string; // ex: DPC
  duration_total: string;
  format: 'Présentiel' | 'E-Learning' | 'Classe Virtuelle' | 'Hybride';
  instructor_name: string;
  instructor_bio: string;
  program_details: string; // Texte riche ou structuré
  image?: string;
  e_learning_hours?: number | null;
  epp_hours?: number | null;
  virtual_class_hours?: number | null;
  created_at?: string;
}

export interface Comment {
  id: string;
  lead_id: string;
  user_id: string;
  content: string;
  created_at: string;
  profile?: Profile; // Joined data
}

export interface Task {
  id: string;
  lead_id?: string;
  assigned_to: string;
  title: string;
  due_date: string;
  completed: boolean;
  created_at: string;
  lead?: Lead; // Joined data
  assignee?: Profile; // Joined data
}

export interface AppSetting {
    key: string;
    value: string;
    description?: string;
}
