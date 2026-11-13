export type HazardType = 'damp_mould' | 'leak' | 'electrical' | 'gas' | 'fire' | 'other';
export type Severity = 'routine' | 'moderate' | 'significant' | 'emergency';
export type CaseStatus = 'new' | 'investigating' | 'awaiting_approval' | 'scheduled' | 'in_progress' | 'resolved' | 'escalated';
export type Skill = 'general' | 'damp_mould' | 'plumbing' | 'electrical' | 'gas' | 'fire';
export type JobStatus = 'unassigned' | 'assigned' | 'travelling' | 'on_site' | 'completed' | 'unable_to_complete';
export type ApprovalStatus = 'pending' | 'approved' | 'rejected';
export type ContactMethod = 'phone' | 'text' | 'email';

export interface Evidence { kind: 'photo' | 'audio' | 'text' | string; uri?: string | null; description?: string | null; }
export interface Deadlines { investigate_by?: string | null; make_safe_by?: string | null; start_works_by?: string | null; verified: boolean; review_required: boolean; policy_phase?: string | null; notes: string[]; }
export interface Property { id: string; display_address: string; postcode: string; district: string; area: string; lat: number; lon: number; archetype: string; floors: number; bedrooms: number; synthetic: boolean; }
export interface ResidentContact { name: string; contact_number: string; preferred_contact: ContactMethod; access_notes?: string; }
export interface Report { id: string; text: string; category: HazardType; property_id: string; contact: ResidentContact; evidence: Evidence[]; submitted_at: string; simulated: boolean; }
export interface Case { id: string; report_id?: string; hazard_type: HazardType; hhsrs_category: string | null; severity: Severity; is_emergency: boolean; room: string | null; vulnerable_occupants: string[]; summary: string; evidence: Evidence[]; deadlines: Deadlines; status: CaseStatus; property_id: string; created_at: string; updated_at: string; simulated: boolean; }
export interface Worker { id: string; name: string; role: string; skills: Skill[]; shift_start: string; shift_end: string; lat: number; lon: number; home_district: string; }
export interface Job { id: string; case_id: string; property_id: string; required_skill: Skill; duration_minutes: number; lat: number; lon: number; earliest: string | null; latest: string | null; priority: number; status: JobStatus; completion_notes?: string; evidence_count?: number; updated_at: string; }
export interface Stop { job_id: string; eta: string; lat: number; lon: number; slack_minutes: number | null; }
export interface WorkerPlan { worker_id: string; stops: Stop[]; }
export interface RouteChange { job_id: string; from_worker_id?: string; to_worker_id?: string; change: 'added' | 'moved' | 'dropped'; }
export interface SchedulePlan { id: string; solver: string; solver_ms: number; workers: WorkerPlan[]; unassigned_jobs: string[]; conflicts: string[]; created_at: string; approved: boolean; kind: 'initial' | 'replan'; changes: RouteChange[]; simulated: boolean; }
export interface Assignment { id: string; plan_id: string; worker_id: string; job_id: string; eta: string; sequence: number; active: boolean; }
export interface Approval { id: string; case_id: string; plan_id: string; action: string; status: ApprovalStatus; requested_at: string; decided_at: string | null; decided_by: string | null; reason: string | null; }
export interface AgentActivity { id: string; case_id: string | null; type: string; summary: string; tool_name: string | null; payload: Record<string, unknown>; success: boolean | null; created_at: string; simulated: boolean; }
export interface AppNotification { id: string; kind: 'info' | 'success' | 'warning' | 'critical'; title: string; message: string; created_at: string; read: boolean; }

export interface DemoState {
  schema_version: 1;
  revision: number;
  properties: Property[];
  reports: Report[];
  cases: Case[];
  workers: Worker[];
  jobs: Job[];
  proposals: SchedulePlan[];
  active_plan: SchedulePlan | null;
  assignments: Assignment[];
  approvals: Approval[];
  activity: AgentActivity[];
  notifications: AppNotification[];
}

export interface CreateReportInput {
  text?: string;
  category: HazardType;
  property_id: string;
  contact: ResidentContact;
  evidence?: Array<Omit<Evidence, 'uri'> & { uri?: never }>;
}

export interface ReportMedia { photos?: File[]; audio?: Blob | null; audioName?: string; }
export interface ReportResult { case: Case; plan: SchedulePlan | null; approval: Approval | null; warnings: string[]; }
export type DataSourceMode = 'mock' | 'api';
export type ConnectionStatus = 'demo' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected';
export interface ConnectionState { mode: DataSourceMode; status: ConnectionStatus; apiUrl?: string; message?: string; }

export interface MockService {
  getState(): DemoState;
  subscribe(listener: () => void): () => void;
  createReport(input: CreateReportInput): { report: Report; case: Case };
  getCases(): Case[];
  getProperties(): Property[];
  getWorkers(): Worker[];
  getAssignedJobs(workerId: string): Job[];
  generateScheduleProposal(caseId?: string): SchedulePlan;
  approveProposal(planId: string, decidedBy?: string): SchedulePlan;
  rejectProposal(planId: string, reason: string, decidedBy?: string): void;
  simulateEmergency(): { case: Case; proposal: SchedulePlan };
  updateJobProgress(jobId: string, status: JobStatus, notes?: string): Job;
  recordActivity(event: Pick<AgentActivity, 'case_id' | 'type' | 'summary'> & Partial<AgentActivity>): AgentActivity;
  reset(): void;
}
