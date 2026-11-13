import type { AgentActivity, Approval, Case, CaseStatus, Deadlines, HazardType, Job, Property, RouteChange, SchedulePlan, Severity, Skill, Worker } from '../types/domain';
import type { ApiApproval, ApiCase, ApiEvent, ApiPlan, ApiWorker } from './apiTypes';

const hazards = new Set(['damp_mould','leak','electrical','gas','fire','other']);
const severities = new Set(['routine','moderate','significant','emergency']);
const statuses = new Set(['new','investigating','awaiting_approval','scheduled','in_progress','resolved','escalated']);
const skills = new Set(['general','damp_mould','plumbing','electrical','gas','fire']);
const hazardSkill: Record<HazardType, Skill> = { damp_mould:'damp_mould',leak:'plumbing',electrical:'electrical',gas:'gas',fire:'fire',other:'general' };

export const mapCase = (value: ApiCase): Case => ({
  id:String(value.id), hazard_type:(hazards.has(value.hazard_type)?value.hazard_type:'other') as HazardType,
  hhsrs_category:value.hhsrs_category ?? null, severity:(severities.has(value.severity)?value.severity:'routine') as Severity,
  is_emergency:Boolean(value.is_emergency), room:value.room ?? null, vulnerable_occupants:Array.isArray(value.vulnerable_occupants)?value.vulnerable_occupants.map(String):[],
  summary:String(value.summary || 'Case details unavailable'), evidence:Array.isArray(value.evidence)?value.evidence.map((e)=>({kind:String(e.kind),uri:e.uri??null,description:e.description??null})):[],
  deadlines:mapDeadlines(value.deadlines), status:(statuses.has(value.status)?value.status:'new') as CaseStatus,
  property_id:value.property_id ? String(value.property_id) : '', created_at:String(value.created_at), updated_at:String(value.updated_at ?? value.created_at), simulated:false,
});

function mapDeadlines(value?: Record<string, unknown>): Deadlines { return { investigate_by:stringOrNull(value?.investigate_by),make_safe_by:stringOrNull(value?.make_safe_by),start_works_by:stringOrNull(value?.start_works_by),verified:value?.verified===true,review_required:value?.review_required!==false,policy_phase:stringOrNull(value?.policy_phase),notes:Array.isArray(value?.notes)?value.notes.map(String):[] }; }
const stringOrNull=(value:unknown)=>typeof value==='string'?value:null;

export const mapWorker = (value: ApiWorker): Worker => { const workerSkills=(value.skills??[]).filter((s)=>skills.has(s)) as Skill[]; return { id:String(value.id),name:String(value.name),role:workerSkills.length?workerSkills.map(humanise).join(' / '):'Repair operative',skills:workerSkills,shift_start:String(value.shift_start),shift_end:String(value.shift_end),lat:Number(value.lat),lon:Number(value.lon),home_district:'Base unavailable' }; };

export function mapPlan(value: ApiPlan, kind:'initial'|'replan'='initial', changes:RouteChange[]=[]): SchedulePlan { return { id:String(value.id),solver:String(value.solver||'unknown'),solver_ms:Number(value.solver_ms)||0,workers:Array.isArray(value.workers)?value.workers.map((w)=>({worker_id:String(w.worker_id),stops:Array.isArray(w.stops)?w.stops.map((s)=>({job_id:String(s.job_id),eta:String(s.eta),lat:Number(s.lat),lon:Number(s.lon),slack_minutes:s.slack_minutes??null})):[]})):[],unassigned_jobs:Array.isArray(value.unassigned_jobs)?value.unassigned_jobs.map(String):[],conflicts:Array.isArray(value.conflicts)?value.conflicts.map(String):[],created_at:String(value.created_at),approved:Boolean(value.approved),kind,changes,simulated:false }; }

export const mapApproval = (value: ApiApproval): Approval => ({ id:String(value.id),case_id:String(value.case_id),plan_id:typeof value.payload?.plan_id==='string'?value.payload.plan_id:'',action:String(value.action),status:(['pending','approved','rejected'].includes(value.status)?value.status:'pending') as Approval['status'],requested_at:String(value.requested_at),decided_at:value.decided_at??null,decided_by:value.decided_by??null,reason:value.outcome??null });
export const mapEvent = (value: ApiEvent): AgentActivity => ({ id:String(value.id),case_id:value.case_id??null,type:String(value.type),summary:String(value.summary),tool_name:value.tool_name??null,payload:value.payload??{},success:value.success??null,created_at:String(value.created_at),simulated:false });

export function jobsFromPlans(plans: SchedulePlan[], cases: Case[]): Job[] { const byId=new Map<string,Job>(); for(const plan of plans) for(const route of plan.workers) for(const stop of route.stops){ const caseId=stop.job_id.startsWith('job-')?stop.job_id.slice(4):''; const c=cases.find((item)=>item.id===caseId); const job:Job={id:stop.job_id,case_id:c?.id??caseId,property_id:c?.property_id??'',required_skill:hazardSkill[c?.hazard_type??'other'],duration_minutes:60,lat:stop.lat,lon:stop.lon,earliest:null,latest:null,priority:c?.is_emergency?5:c?.severity==='significant'?3:2,status:plan.approved?'assigned':'unassigned',updated_at:plan.created_at}; const current=byId.get(job.id); if(!current||plan.approved) byId.set(job.id,job); } return [...byId.values()]; }

export function mapProperty(value: Record<string, unknown>): Property { return { id:String(value.id),display_address:`Synthetic home ${String(value.id)}`,postcode:String(value.district??'Sheffield'),district:String(value.district??''),area:String(value.area??'Sheffield'),lat:Number(value.lat),lon:Number(value.lon),archetype:String(value.archetype??'property'),floors:Number(value.floors)||1,bedrooms:Number(value.bedrooms)||0,synthetic:true }; }
const humanise=(value:string)=>value.replaceAll('_',' ');
