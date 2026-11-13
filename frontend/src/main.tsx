import React, {useEffect, useState} from "react";
import {createRoot} from "react-dom/client";
import "./style.css";
const API = import.meta.env.VITE_API_URL || "http://127.0.0.1:8000";
const colours: Record<string,string> = {emergency:"#ef4444", significant:"#f97316", moderate:"#eab308", routine:"#9ca3af", scheduled:"#3b82f6", resolved:"#22c55e"};
type Case = {id:string; summary:string; severity:string; status:string; deadlines:{investigate_by?:string}};
function App() {
  const [cases,setCases] = useState<Case[]>([]); const [text,setText] = useState("Black mould in my child's bedroom"); const [feed,setFeed] = useState<string[]>([]);
  const refresh = () => fetch(`${API}/api/cases`).then(r=>r.json()).then(setCases).catch(()=>{});
  useEffect(()=>{refresh(); const source = new EventSource(`${API}/api/stream`); source.onmessage = e => setFeed(f=>[e.data,...f].slice(0,8)); return ()=>source.close()},[]);
  async function submit() { await fetch(`${API}/api/reports`, {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({text,property_id:"p-001"})}); refresh(); }
  return <main><header><h1>HomeShield</h1><p>Live Sheffield housing operations twin</p></header><section className="counters"><b>{cases.length} open cases</b><b>{cases.filter(c=>c.severity==="emergency").length} emergencies</b><b>{cases.filter(c=>c.status==="awaiting_approval").length} awaiting approval</b></section><section className="grid"><article className="twin"><h2>Digital twin</h2><div className="map">{cases.map(c=><span key={c.id} title={c.summary} style={{background:colours[c.severity]}}>{c.severity==="emergency"?"!":"•"}</span>)}</div><small>Offline geometry placeholder; local GeoJSON is loaded here next.</small></article><aside><h2>Resident report</h2><textarea value={text} onChange={e=>setText(e.target.value)}/><button onClick={submit}>Submit report</button><h2>Cases</h2>{cases.map(c=><div className="card" key={c.id}><strong style={{color:colours[c.severity]}}>{c.severity}</strong><p>{c.summary}</p><small>{c.status}</small></div>)}<h2>Agent activity</h2><pre>{feed.join("\n")}</pre></aside></section></main>
}
createRoot(document.getElementById("root")!).render(<React.StrictMode><App/></React.StrictMode>);
