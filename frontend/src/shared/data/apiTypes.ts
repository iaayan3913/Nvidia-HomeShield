export interface ApiEvidence { kind: string; uri?: string | null; description?: string | null }
export interface ApiCase { id: string; hazard_type: string; hhsrs_category?: string | null; severity: string; is_emergency: boolean; room?: string | null; vulnerable_occupants?: string[]; summary: string; evidence?: ApiEvidence[]; deadlines?: Record<string, unknown>; status: string; property_id?: string | null; created_at: string; updated_at?: string }
export interface ApiWorker { id: string; name: string; skills?: string[]; shift_start: string; shift_end: string; lat: number; lon: number }
export interface ApiStop { job_id: string; eta: string; lat: number; lon: number; slack_minutes?: number | null }
export interface ApiPlan { id: string; solver: string; solver_ms: number; workers?: Array<{ worker_id: string; stops?: ApiStop[] }>; unassigned_jobs?: string[]; conflicts?: string[]; created_at: string; approved: boolean }
export interface ApiApproval { id: string; case_id: string; action: string; payload?: Record<string, unknown>; status: string; requested_at: string; decided_at?: string | null; decided_by?: string | null; outcome?: string | null }
export interface ApiEvent { sequence?: number; id: string; case_id?: string | null; type: string; summary: string; tool_name?: string | null; payload?: Record<string, unknown>; success?: boolean | null; created_at: string }
export interface ApiReportResponse { case: ApiCase; plan?: ApiPlan | null; approval?: ApiApproval | null; warnings?: string[]; safety_notice?: string }
