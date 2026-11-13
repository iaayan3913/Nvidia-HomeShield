import type { DemoState, Property, Worker } from '../types/domain';

const at = (hour: number, minute = 0) => `2026-11-13T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00.000Z`;

export const properties: Property[] = [
  ['p-001','14 Rowan Court','S5 8QJ','S5','Parson Cross',53.4206,-1.4585,'low_rise_flat',3,2],
  ['p-002','8 Norfolk View','S2 2PL','S2','Norfolk Park',53.3688,-1.4487,'maisonette',4,3],
  ['p-003','27 Gleadless Rise','S14 1TD','S14','Gleadless Valley',53.3472,-1.4395,'terrace',2,3],
  ['p-004','51 Darnall Lane','S9 4EU','S9','Darnall',53.3951,-1.4144,'terrace',2,2],
  ['p-005','33 Walkley Bank','S6 3TN','S6','Walkley',53.4028,-1.5032,'semi_detached',2,3],
  ['p-006','72 Burngreave Road','S4 7LP','S4','Burngreave',53.4002,-1.4536,'low_rise_flat',3,2],
  ['p-007','19 Woodhouse Close','S13 7RA','S13','Woodhouse',53.3652,-1.3817,'semi_detached',2,3],
  ['p-008','4 Manor Oaks','S2 5QZ','S2','Manor',53.3721,-1.4438,'high_rise_flat',12,1],
  ['p-009','88 Chaucer Green','S5 8NP','S5','Parson Cross',53.4240,-1.4612,'terrace',2,3],
  ['p-010','11 Hackenthorpe Way','S12 4RF','S12','Hackenthorpe',53.3438,-1.4086,'bungalow',1,2],
  ['p-110','42 Park Hill View','S2 5AB','S2','Park Hill',53.3704,-1.4511,'high_rise_flat',14,2],
  ['p-111','6 Shiregreen Avenue','S5 0LP','S5','Shiregreen',53.4261,-1.4484,'semi_detached',2,3],
].map(([id,display_address,postcode,district,area,lat,lon,archetype,floors,bedrooms]) => ({ id, display_address, postcode, district, area, lat, lon, archetype, floors, bedrooms, synthetic: true } as Property));

export const workers: Worker[] = [
  ['w-1','Amira Hussain','Damp and mould specialist',['general','damp_mould'],7,15,'S5',53.4220,-1.4585],
  ['w-2','Dan Clarke','Plumbing and gas engineer',['general','plumbing','gas'],8,16,'S2',53.3712,-1.4485],
  ['w-3','Priya Patel','Electrical engineer',['electrical','fire'],8,16,'S9',53.3930,-1.4115],
  ['w-4','Tom Walker','Gas engineer',['gas','plumbing'],8,16,'S14',53.3450,-1.4380],
  ['w-5','Grace Okafor','Multi-skilled operative',['general','damp_mould','plumbing'],9,17,'S6',53.4052,-1.5035],
  ['w-6','Kieran Shaw','Electrical operative',['electrical','general'],9,17,'S12',53.3438,-1.4085],
  ['w-7','Leah Fletcher','Repairs operative',['general','damp_mould'],10,18,'S4',53.3990,-1.4505],
  ['w-8','Sam Ahmed','Fire safety operative',['general','fire'],7,15,'S13',53.3652,-1.3785],
].map(([id,name,role,skills,start,end,home_district,lat,lon]) => ({ id,name,role,skills,shift_start:at(start as number),shift_end:at(end as number),home_district,lat,lon } as Worker));

export function createInitialState(): DemoState {
  const baseCases: DemoState['cases'] = [
    { id:'HS-26041', hazard_type:'leak', hhsrs_category:null, severity:'significant', is_emergency:false, room:'Kitchen', vulnerable_occupants:[], summary:'Water leaking beneath the kitchen sink', evidence:[], deadlines:{ investigate_by:at(15), make_safe_by:null, start_works_by:null, verified:false, review_required:true, notes:['Demonstration deadline requires officer review.'] }, status:'scheduled', property_id:'p-002', created_at:at(9,5), updated_at:at(9,20), simulated:true },
    { id:'HS-26042', hazard_type:'electrical', hhsrs_category:null, severity:'moderate', is_emergency:false, room:'Hallway', vulnerable_occupants:[], summary:'Hallway socket is warm and intermittently cuts out', evidence:[], deadlines:{ investigate_by:at(16), make_safe_by:null, start_works_by:null, verified:false, review_required:true, notes:['Mock classification only.'] }, status:'investigating', property_id:'p-004', created_at:at(9,18), updated_at:at(9,18), simulated:true },
  ];
  const jobs: DemoState['jobs'] = [
    { id:'j-041', case_id:'HS-26041', property_id:'p-002', required_skill:'plumbing', duration_minutes:60, lat:53.3688, lon:-1.4487, earliest:at(10), latest:at(14), priority:3, status:'assigned', updated_at:at(9,20) },
    { id:'j-042', case_id:'HS-26042', property_id:'p-004', required_skill:'electrical', duration_minutes:45, lat:53.3951, lon:-1.4144, earliest:at(12), latest:at(16), priority:2, status:'assigned', updated_at:at(9,22) },
  ];
  const plan: NonNullable<DemoState['active_plan']> = { id:'plan-base', solver:'mock-deterministic', solver_ms:4.2, workers:[{worker_id:'w-2',stops:[{job_id:'j-041',eta:at(10,30),lat:53.3688,lon:-1.4487,slack_minutes:210}]},{worker_id:'w-3',stops:[{job_id:'j-042',eta:at(12,15),lat:53.3951,lon:-1.4144,slack_minutes:225}]}], unassigned_jobs:[], conflicts:[], created_at:at(9,22), approved:true, kind:'initial', changes:[], simulated:true };
  return { schema_version:1, revision:1, properties, reports:[], cases:baseCases, workers, jobs, proposals:[], active_plan:plan, assignments:[{id:'a-base-1',plan_id:plan.id,worker_id:'w-2',job_id:'j-041',eta:at(10,30),sequence:0,active:true},{id:'a-base-2',plan_id:plan.id,worker_id:'w-3',job_id:'j-042',eta:at(12,15),sequence:0,active:true}], approvals:[], activity:[{id:'evt-base',case_id:null,type:'demo.ready',summary:'Demonstration workspace reset and ready',tool_name:null,payload:{},success:true,created_at:at(9),simulated:true}], notifications:[] };
}
