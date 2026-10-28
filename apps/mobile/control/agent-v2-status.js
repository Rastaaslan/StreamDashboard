/** The native bridge owns credentials and polling; renderers see health only. */
export function agentStatusText(value,now=Date.now()){
 if(!value||value.status==='not_configured')return '';
 const observation=value.observation;
 if(value.status!=='connected'||!observation||!Number.isFinite(observation.staleAt)||
    observation.staleAt<=now||observation.payload?.connected!==true||
    typeof observation.payload.active!=='boolean')return 'PC de stream indisponible · reconnexion en cours';
 return 'PC de stream disponible · '+(observation.payload.active?'diffusion active':'diffusion arrêtée');
}
export function mountAgentStatus(root,read=globalThis.streamDashboardDesktop?.readNodeAgentStatus){
 if(typeof read!=='function')return {refresh(){},destroy(){}};
 const label=document.createElement('p');label.className='small muted';label.setAttribute('role','status');
 label.hidden=true;root.append(label);
 let disposed=false,flight=false,current;
 const draw=()=>{label.textContent=agentStatusText(current);label.hidden=!label.textContent};
 const refresh=async()=>{
  if(disposed)return;
  draw();if(flight)return;
  flight=true;
  try{const value=await read();if(!disposed){current=value;draw()}}
  catch{if(!disposed){current={status:'unavailable',observation:null};draw()}}
  finally{flight=false}
 };
 const timer=setInterval(()=>{void refresh()},2000);
 void refresh();
 return {refresh,destroy(){disposed=true;clearInterval(timer);label.remove()}};
}
