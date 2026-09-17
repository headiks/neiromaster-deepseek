// Лёгкие типы под ответы API. Намеренно нестрогие там, где бэкенд отдаёт свободные
// структуры (планы, расписания) — моделируем только то, что реально используется в UI.

export type Role = 'owner' | 'admin' | 'employee';

export interface Me {
  id: string;
  username: string;
  full_name?: string;
  role: Role;
}

export interface Employee {
  id: string;
  full_name: string;
  username?: string;
  role: Role;
  position?: string;
  department?: string;
  contact?: string;
  mentor?: string;
  manager?: string;
  plan_id?: string;
  plan_title?: string;
  plan_generated?: boolean;
  start_date?: string;
  status?: string;
  notes?: string;
  active?: boolean;
  must_change_credentials?: boolean;
}

export interface DocItem {
  filename: string;
  status: 'uploaded' | 'processing' | 'indexed' | 'reanalyzing' | 'error';
  mime?: string;
  size_bytes?: number;
  chunks?: number;
  progress?: number;
  phase?: string;
  uploaded_at?: string;
  uploaded_by_name?: string;
  department?: string;
  storage_path?: string;
  folders?: string[];
  summary?: string;
  clarification?: string;
  error?: string;
  score?: number;
  similar?: { filename: string }[];
}

export interface Folder {
  id: string;
  slug: string;
  name: string;
  description?: string;
  criteria: string[];
  enabled: boolean;
  documents?: number;
}

export interface PlanRef {
  plan_id: string;
  title: string;
  role?: string;
  generated?: boolean;
}

export interface Job {
  status: 'running' | 'done' | 'error' | 'cancelled' | string;
  done: number;
  total: number;
  current?: string;
  skipped?: number;
  errors?: number;
  error?: string;
  result?: any;
  job_id?: string;
}

export interface Question {
  id: string;
  question: string;
  resolved_question?: string;
  reason?: string;
  status?: string;
  user_name?: string;
  position?: string;
  contact?: string;
  mentor?: string;
  answer?: string;
  answered_by?: string;
  answered_at?: string;
  created_at?: string;
}

// Планы и расписания используем как свободные структуры.
export type Plan = any;
export type ScheduleMessage = any;
export type Catalog = any;
