import { createInitialState } from './fixtures';
import type { AgentActivity, AppNotification, Case, CreateReportInput, DemoState, HazardType, Job, JobStatus, MockService, SchedulePlan, Severity, Skill } from '../types/domain';

/** Allowed operative progress transitions (mirrors backend JOB_TRANSITIONS). */
export const JOB_TRANSITIONS: Partial<Record<JobStatus, JobStatus[]>> = { assigned:['travelling','on_site','unable_to_complete'], travelling:['on_site','unable_to_complete'], on_site:['completed','unable_to_complete'], unable_to_complete:['travelling','on_site'] };

const STORAGE_KEY = 'homeshield.demo-state.v1';
const CHANNEL = 'homeshield-demo-sync';
const now = () => new Date().toISOString();
const clone = <T,>(value: T): T => structuredClone(value);
const hazardSkill: Record<HazardType, Skill> = { damp_mould:'damp_mould', leak:'plumbing', electrical:'electrical', gas:'gas', fire:'fire', other:'general' };
const severityFor = (hazard: HazardType): Severity => hazard === 'gas' || hazard === 'fire' ? 'emergency' : hazard === 'electrical' || hazard === 'leak' ? 'significant' : 'moderate';

/** `local` mode: the in-browser service used by tests and offline development. */
export class LocalMockService implements MockService {
  private state: DemoState = this.load();
  private listeners = new Set<() => void>();
  private channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(CHANNEL) : null;

  constructor() {
    this.channel?.addEventListener('message', () => { this.state = this.load(); this.emit(); });
    if (typeof window !== 'undefined') window.addEventListener('storage', (event) => { if (event.key === STORAGE_KEY) { this.state = this.load(); this.emit(); } });
  }
  private load(): DemoState {
    if (typeof localStorage === 'undefined') return createInitialState();
    try { const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as DemoState | null; return saved?.schema_version === 1 ? saved : createInitialState(); }
    catch { return createInitialState(); }
  }
  private save(next: DemoState) {
    this.state = { ...next, revision: next.revision + 1 };
    if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    this.channel?.postMessage({ revision: this.state.revision }); this.emit();
  }
  private emit() { this.listeners.forEach((listener) => listener()); }
  private id(prefix: string) { const sequence = this.state.revision + this.state.activity.length + this.state.cases.length; return `${prefix}-${String(sequence).padStart(4,'0')}`; }
  getState = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  getCases = () => clone(this.state.cases);
  getProperties = () => clone(this.state.properties);
  getWorkers = () => clone(this.state.workers);

  async findProperties(query: string) { const q = query.trim().toLowerCase(); return clone(this.state.properties.filter((p) => !q || p.postcode.toLowerCase().startsWith(q.split(' ')[0]!) || p.display_address.toLowerCase().includes(q) || p.area.toLowerCase().includes(q)).slice(0, 20)); }

  async createReport(input: CreateReportInput) {
    if (!input.text?.trim() && !input.evidence?.length && !input.photo && !input.audio) throw new Error('Add a description, photo or voice note.');
    const property = this.state.properties.find((item) => item.id === input.property_id); if (!property) throw new Error('Choose your home from the list.');
    const submitted = now(); const reportId = this.id('report'); const caseId = `HS-${String(26043 + this.state.reports.length)}`;
    const media: Array<{ kind: string; description?: string | null }> = [...(input.evidence ?? []), ...(input.photo ? [{ kind:'photo' }] : []), ...(input.audio ? [{ kind:'audio' }] : [])];
    const evidence = media.map((item) => ({ kind:item.kind, uri:null, description:item.description || 'Media kept on this device only; not stored.' }));
    const report = { id:reportId, text:input.text?.trim() ?? '', category:input.category, property_id:property.id, contact:input.contact, evidence, submitted_at:submitted, simulated:true as const };
    const severity = severityFor(input.category);
    const housingCase: Case = { id:caseId, report_id:reportId, hazard_type:input.category, hhsrs_category:null, severity, is_emergency:severity==='emergency', room:null, vulnerable_occupants:[], summary:report.text || `${input.category.replaceAll('_',' ')} report with media evidence`, evidence, deadlines:{investigate_by:null,make_safe_by:null,start_works_by:null,verified:false,review_required:true,notes:['Simulated classification. A housing officer must review urgency and applicable deadlines.']}, status:'awaiting_approval', property_id:property.id, created_at:submitted, updated_at:submitted, simulated:true };
    const job: Job = { id:this.id('job'),case_id:caseId,property_id:property.id,required_skill:hazardSkill[input.category],duration_minutes:60,lat:property.lat,lon:property.lon,earliest:null,latest:null,priority:severity==='emergency'?5:severity==='significant'?3:2,status:'unassigned',updated_at:submitted };
    const activity = this.makeActivity({case_id:caseId,type:'report.received',summary:'Resident report received; simulated intake review requested'});
    this.save({...this.state,reports:[report,...this.state.reports],cases:[housingCase,...this.state.cases],jobs:[job,...this.state.jobs],activity:[activity,...this.state.activity],notifications:[this.notice('info','New demonstration report',`${caseId} is ready for officer review.`),...this.state.notifications]});
    return { report:clone(report), case:clone(housingCase) };
  }

  getAssignedJobs(workerId: string) { const ids = new Set(this.state.assignments.filter((a) => a.active && a.worker_id === workerId).map((a) => a.job_id)); return clone(this.state.jobs.filter((job) => ids.has(job.id))); }

  async generateScheduleProposal(caseId?: string) {
    const candidateJobs = this.state.jobs.filter((job) => job.status === 'unassigned' && (!caseId || job.case_id === caseId));
    if (!candidateJobs.length) throw new Error('There are no unassigned jobs to schedule.');
    const workers = new Map<string, SchedulePlan['workers'][number]>(); const changes: SchedulePlan['changes'] = []; const unassigned: string[] = [];
    candidateJobs.forEach((job, index) => { const worker = this.state.workers.find((item) => item.skills.includes(job.required_skill)); if (!worker) { unassigned.push(job.id); return; } const route = workers.get(worker.id) ?? {worker_id:worker.id,stops:[]}; route.stops.push({job_id:job.id,eta:new Date(Date.now()+(index+1)*3600000).toISOString(),lat:job.lat,lon:job.lon,slack_minutes:60}); workers.set(worker.id,route); changes.push({job_id:job.id,to_worker_id:worker.id,change:'added'}); });
    const proposal: SchedulePlan = { id:this.id('plan'),solver:'mock-deterministic',solver_ms:5.4,workers:[...workers.values()],unassigned_jobs:unassigned,conflicts:unassigned.length?['Some jobs have no suitably skilled operative.']:[],created_at:now(),approved:false,kind:'initial',changes,simulated:true };
    const approval = {id:this.id('approval'),case_id:caseId ?? candidateJobs[0]!.case_id,plan_id:proposal.id,action:'activate_schedule' as const,status:'pending' as const,requested_at:now(),decided_at:null,decided_by:null,reason:null};
    this.save({...this.state,proposals:[proposal,...this.state.proposals],approvals:[approval,...this.state.approvals],activity:[this.makeActivity({case_id:approval.case_id,type:'plan.proposed',summary:'A deterministic demonstration schedule is ready for human approval'}),...this.state.activity]}); return clone(proposal);
  }

  async approveProposal(planId: string, decidedBy='housing-officer') {
    const proposal = this.state.proposals.find((item) => item.id === planId); if (!proposal) throw new Error('Schedule proposal not found.');
    const approved = {...proposal,approved:true}; const stamp = now();
    const assignments = proposal.workers.flatMap((route) => route.stops.map((stop,index) => ({id:`a-${planId}-${route.worker_id}-${index}`,plan_id:planId,worker_id:route.worker_id,job_id:stop.job_id,eta:stop.eta,sequence:index,active:true})));
    const assignedIds = new Set(assignments.map((item) => item.job_id));
    // A re-plan only replaces the stops it mentions; every other active assignment stays in place.
    const keep = (item: DemoState['assignments'][number]) => proposal.kind==='replan' && item.active && !assignedIds.has(item.job_id);
    this.save({...this.state,proposals:this.state.proposals.map((item)=>item.id===planId?approved:item),active_plan:approved,assignments:[...assignments,...this.state.assignments.map((item)=>keep(item)?item:{...item,active:false})],approvals:this.state.approvals.map((item)=>item.plan_id===planId?{...item,status:'approved',decided_at:stamp,decided_by:decidedBy}:item),jobs:this.state.jobs.map((job)=>assignedIds.has(job.id)?{...job,status:'assigned',updated_at:stamp}:job),cases:this.state.cases.map((item)=>assignedIds.has(this.state.jobs.find((job)=>job.case_id===item.id)?.id ?? '')?{...item,status:'scheduled',updated_at:stamp}:item),activity:[this.makeActivity({case_id:null,type:'plan.activated',summary:'Human-approved demonstration schedule activated'}),...this.state.activity],notifications:[this.notice('success','Schedule activated','Operative assignments now reflect the approved plan.'),...this.state.notifications]}); return clone(approved);
  }

  async rejectProposal(planId:string, reason:string, decidedBy='housing-officer') { const proposal=this.state.proposals.find((item)=>item.id===planId); if(!proposal) throw new Error('Schedule proposal not found.'); this.save({...this.state,approvals:this.state.approvals.map((item)=>item.plan_id===planId?{...item,status:'rejected',decided_at:now(),decided_by:decidedBy,reason}:item),activity:[this.makeActivity({case_id:null,type:'plan.rejected',summary:'Officer rejected the demonstration schedule; the active plan was unchanged'}),...this.state.activity]}); }

  async simulateEmergency() {
    const existing=this.state.cases.find((item)=>item.id==='HS-EMERGENCY-1'); if(existing){const proposal=this.state.proposals.find((item)=>item.kind==='replan'); if(!proposal) throw new Error('Emergency exists without its proposal. Reset the demo.'); return {case:clone(existing),proposal:clone(proposal)};}
    const property=this.state.properties.find((item)=>item.id==='p-110')!; const stamp=now();
    const emergency:Case={id:'HS-EMERGENCY-1',hazard_type:'gas',hhsrs_category:null,severity:'emergency',is_emergency:true,room:'Kitchen',vulnerable_occupants:[],summary:'Strong smell of gas reported in the kitchen',evidence:[],deadlines:{investigate_by:null,make_safe_by:null,start_works_by:null,verified:false,review_required:true,notes:['Emergency simulation only. Call 999 for immediate danger or 0800 111 999 for the National Gas Emergency Service.']},status:'awaiting_approval',property_id:property.id,created_at:stamp,updated_at:stamp,simulated:true};
    const job:Job={id:'job-emergency-1',case_id:emergency.id,property_id:property.id,required_skill:'gas',duration_minutes:60,lat:property.lat,lon:property.lon,earliest:stamp,latest:new Date(Date.now()+2*3600000).toISOString(),priority:5,status:'unassigned',updated_at:stamp};
    const activeGas=this.state.assignments.find((item)=>item.active&&this.state.workers.find((worker)=>worker.id===item.worker_id)?.skills.includes('gas')); const gasWorker=activeGas?.worker_id ?? 'w-4';
    const proposal:SchedulePlan={id:'plan-emergency-replan',solver:'mock-deterministic',solver_ms:3.8,workers:[{worker_id:gasWorker,stops:[{job_id:job.id,eta:new Date(Date.now()+35*60000).toISOString(),lat:job.lat,lon:job.lon,slack_minutes:85}]}],unassigned_jobs:[],conflicts:[],created_at:stamp,approved:false,kind:'replan',changes:[{job_id:job.id,to_worker_id:gasWorker,change:'added'}],simulated:true};
    const approval={id:'approval-emergency',case_id:emergency.id,plan_id:proposal.id,action:'activate_replan' as const,status:'pending' as const,requested_at:stamp,decided_at:null,decided_by:null,reason:null};
    this.save({...this.state,cases:[emergency,...this.state.cases],jobs:[job,...this.state.jobs],proposals:[proposal,...this.state.proposals],approvals:[approval,...this.state.approvals],activity:[this.makeActivity({case_id:emergency.id,type:'plan.replan_completed',summary:'Emergency simulation created a revised schedule for officer review'}),...this.state.activity],notifications:[this.notice('critical','Simulated emergency','Review the proposed re-plan before it can become active.'),...this.state.notifications]}); return {case:clone(emergency),proposal:clone(proposal)};
  }

  async updateJobProgress(jobId:string,status:JobStatus,notes?:string,evidenceCount?:number) { const job=this.state.jobs.find((item)=>item.id===jobId); if(!job) throw new Error('Job not found.');
    if(!this.state.assignments.some((a)=>a.active&&a.job_id===jobId)) throw new Error('This job is not on the approved active schedule.');
    if(!JOB_TRANSITIONS[job.status]?.includes(status)) throw new Error(`A job cannot move from ${job.status.replaceAll('_',' ')} to ${status.replaceAll('_',' ')}.`);
    if((status==='completed'||status==='unable_to_complete')&&!notes?.trim()) throw new Error('Add a short note for completed or unable-to-complete jobs.');
    const stamp=now(); const updated={...job,status,completion_notes:notes?.trim()||job.completion_notes,evidence_count:evidenceCount??job.evidence_count,updated_at:stamp}; this.save({...this.state,jobs:this.state.jobs.map((item)=>item.id===jobId?updated:item),cases:this.state.cases.map((item)=>item.id===job.case_id?{...item,status:status==='completed'?'resolved':status==='on_site'?'in_progress':item.status,updated_at:stamp}:item),activity:[this.makeActivity({case_id:job.case_id,type:'job.progress',summary:`Operative marked the demonstration job as ${status.replaceAll('_',' ')}`}),...this.state.activity]}); return clone(updated); }
  private makeActivity(input: Pick<AgentActivity,'case_id'|'type'|'summary'> & Partial<AgentActivity>):AgentActivity { return {id:this.id('event'),case_id:input.case_id,type:input.type,summary:input.summary,tool_name:input.tool_name??null,payload:input.payload??{},success:input.success??true,created_at:input.created_at??now(),simulated:true}; }
  async recordActivity(input: Pick<AgentActivity,'case_id'|'type'|'summary'> & Partial<AgentActivity>) { const event=this.makeActivity(input); this.save({...this.state,activity:[event,...this.state.activity]}); return clone(event); }
  private notice(kind:AppNotification['kind'],title:string,message:string):AppNotification { return {id:this.id('notice'),kind,title,message,created_at:now(),read:false}; }
  async reset() { const fresh=createInitialState(); if(typeof localStorage!=='undefined') localStorage.removeItem(STORAGE_KEY); this.save(fresh); }
}

export const localService = new LocalMockService();
