import { useSyncExternalStore } from 'react';
import { mockService } from '../mock/mockService';
import type { ConnectionState, CreateReportInput, DataSourceMode, DemoState, JobStatus, ReportMedia } from '../types/domain';
import { ApiHomeShieldService } from './ApiHomeShieldService';

const configuredMode:DataSourceMode=import.meta.env.VITE_DATA_SOURCE==='api'?'api':'mock';
const stored=typeof localStorage!=='undefined'?localStorage.getItem('homeshield.data-source.override'):null;
export const dataSourceMode:DataSourceMode=stored==='mock'||stored==='api'?stored:configuredMode;
export const apiUrl=(import.meta.env.VITE_API_URL||'http://127.0.0.1:18100').replace(/\/$/,'');
export const isApiMode=dataSourceMode==='api';
export const apiService=new ApiHomeShieldService(apiUrl);

const mockConnection:ConnectionState={mode:'mock',status:'demo',message:'Deterministic offline demonstration'};
const selected=isApiMode?apiService:mockService;

export const homeShieldService={
  getState:()=>selected.getState(), subscribe:(fn:()=>void)=>selected.subscribe(fn),
  start:()=>isApiMode?apiService.start():Promise.resolve(), stop:()=>{if(isApiMode)apiService.stop()},
  retry:()=>isApiMode?apiService.retry():Promise.resolve(),
  getConnection:()=>isApiMode?apiService.getConnection():mockConnection,
  subscribeConnection:(fn:()=>void)=>isApiMode?apiService.subscribeConnection(fn):()=>{},
  createReport:(input:CreateReportInput,media?:ReportMedia)=>isApiMode?apiService.createReport(input,media):Promise.resolve({...mockService.createReport(input),plan:null,approval:null,warnings:[]}),
  generateScheduleProposal:(caseId?:string)=>isApiMode?apiService.generateScheduleProposal(caseId):Promise.resolve(mockService.generateScheduleProposal(caseId)),
  approveProposal:(planId:string,by?:string)=>isApiMode?apiService.approveProposal(planId,by):Promise.resolve(mockService.approveProposal(planId,by)),
  rejectProposal:(planId:string,reason:string,by?:string)=>isApiMode?apiService.rejectProposal(planId,reason,by):Promise.resolve(mockService.rejectProposal(planId,reason,by)),
  simulateEmergency:()=>isApiMode?apiService.simulateEmergency():Promise.resolve({...mockService.simulateEmergency(),warnings:[]}),
  updateJobProgress:(jobId:string,status:JobStatus,notes?:string)=>isApiMode?apiService.updateJobProgress(jobId,status,notes):Promise.resolve(mockService.updateJobProgress(jobId,status,notes)),
  recordActivity:(event:Parameters<typeof mockService.recordActivity>[0])=>{if(!isApiMode)mockService.recordActivity(event)},
  reset:()=>isApiMode?apiService.reset():mockService.reset(),
};

export function useHomeShieldState<T=DemoState>(selector:(state:DemoState)=>T=(state)=>state as T):T{const state=useSyncExternalStore(homeShieldService.subscribe,homeShieldService.getState,homeShieldService.getState);return selector(state)}
export function useConnectionState(){return useSyncExternalStore(homeShieldService.subscribeConnection,homeShieldService.getConnection,homeShieldService.getConnection)}
export function switchDataSource(mode:DataSourceMode){localStorage.setItem('homeshield.data-source.override',mode);window.location.reload()}
export function useDemoState<T=DemoState>(selector:(state:DemoState)=>T=(state)=>state as T):T{return useHomeShieldState(selector)}
export type * from '../types/domain';
