/**
 * Compact, persistent Mic 3 badge. Reads the *paired* dashboard's read-only
 * telemetry, not Bluetooth/USB directly on Android. No guessed percentages.
 */
const POLL_MS = 30_000;
const MAX_AGE_MS = 90_000;
export function micBadgeState(value, now = Date.now(), previous = new Set()) {
  const unknown = {tone:'offline',text:'🎙 DJI —',compactText:'🎙 DJI · —',detail:'Batteries indisponibles',connected:[]};
  if(!value || value.status!=='ok' || !Array.isArray(value.tx))return unknown;
  const at=Date.parse(value.observedAt||'');
  if(!Number.isFinite(at) || now-at > MAX_AGE_MS || at-now > 15_000)return {...unknown,detail:'Mesure DJI périmée'};
  const tx=value.tx.slice(0,2).filter(t=>t && [1,2].includes(t.slot));
  const connected=tx.filter(t=>t.connected===true).map(t=>t.slot);
  const dropped=tx.some(t=>t.connected===false && previous.has(t.slot));
  const labels=tx.map(t=>{
    const prefix='TX'+t.slot;
    if(t.connected!==true)return prefix+' —';
    const g=t.rawGauge;
    if(!Number.isInteger(g)||g<1||g>7)return prefix+' ?';
    if(t.slot===2&&g===1&&t.calibration==='rx-display-confirmed-tx2')return prefix+' plein';
    return prefix+' '+g+'/7';
  });
  const rx=Number.isInteger(value.rx?.rawGauge)&&value.rx.rawGauge>=1&&value.rx.rawGauge<=7
    ?'RX '+value.rx.rawGauge+'/7':'RX ?';
  const check=[...tx.map(t=>t.connected===true?t.rawGauge:null),value.rx?.rawGauge]
    .some(g=>Number.isInteger(g)&&g>=6&&g<=7);
  const tone=dropped?'critical':check?'check':connected.length?'ok':'idle';
  const detail=dropped?'Un émetteur s’est déconnecté':
    check?'Vérifiez les niveaux sur le récepteur':
    connected.length?'Paliers DJI réels, pourcentages non disponibles':'Aucun TX relié au RX';
  // Only the summary is rendered in the fixed compact header. The
  // human-readable raw 'x/7' values remain in the detailed Mic view.
  const compactParts=tx.map(t=>{
    const prefix='TX'+t.slot;
    if(t.connected!==true)return prefix+' —';
    if(!Number.isInteger(t.rawGauge)||t.rawGauge<1||t.rawGauge>7)return prefix+' ?';
    return prefix+' '+t.rawGauge;
  });
  compactParts.push(Number.isInteger(value.rx?.rawGauge)&&value.rx.rawGauge>=1&&value.rx.rawGauge<=7
    ?'RX '+value.rx.rawGauge:'RX ?');
  const compactText='🎙 DJI · '+compactParts.join(' · ');
  return {tone,text:'🎙 '+labels.join(' · ')+' · '+rx,compactText,detail,connected};
}
export function createFloatingMicBattery(root, {read,onOpen,now=Date.now,intervalMs=POLL_MS}={}) {
  root.className='floating-mic-battery';
  root.hidden=true;
  const button=document.createElement('button');
  button.type='button';
  button.className='floating-mic-battery-button';
  button.setAttribute('aria-label','Ouvrir Spotify et les batteries du DJI Mic 3');
  const line=document.createElement('strong');line.dataset.micFloatText='';
  const info=document.createElement('small');info.dataset.micFloatDetail='';
  button.append(line,info);
  root.append(button);
  button.addEventListener('click',()=>onOpen?.());
  let enabled=false,pending=null,snapshot=null,lastAttempt=0,lastSource='',disposed=false;
  const seenConnected=new Set();
  function draw(){
    if(disposed)return;
    root.hidden=!enabled;
    if(!enabled)return;
    const s=micBadgeState(snapshot,now(),seenConnected);
    root.dataset.tone=s.tone;
    line.textContent=s.compactText;
    info.textContent=s.tone==='ok'?'Jauges brutes /7 · détails':
      s.tone==='check'?'⚠ Paliers 6/7 ou 7/7':
      s.tone==='critical'?'TX déconnecté · vérifier RX':s.detail;
    button.title=s.text+' — '+s.detail;
    button.setAttribute('aria-label',s.text+' — '+s.detail+
      '. Ouvrir Micro / Spotify.');
  }
  async function refresh(force=false) {
    if(!enabled||disposed||pending||typeof read!=='function')return;
    if(!force && lastAttempt && now()-lastAttempt<intervalMs-1000)return;
    lastAttempt=now();
    const current=Promise.resolve().then(read);pending=current;
    try {
      const value=await current;
      if(disposed||!enabled)return;
      snapshot=value;
      // Remember verified connected TXs until the source changes; a failed
      // read is never mistaken for a new disconnect.
      if(value?.status==='ok' && Number.isFinite(Date.parse(value.observedAt||'')) &&
          Math.abs(now()-Date.parse(value.observedAt))<=MAX_AGE_MS) {
        for(const tx of value.tx||[]) if(tx?.connected===true)seenConnected.add(tx.slot);
      }
    }catch{snapshot={status:'unavailable'};}
    finally{if(pending===current)pending=null;draw();}
  }
  const timer=setInterval(()=>{
    if(!enabled||disposed)return;
    draw();
    if(document.visibilityState==='visible')void refresh();
  },5000);
  return {
    update({enabled:next=false,sourceKey=''}={}){
      if(sourceKey!==lastSource){
        lastSource=sourceKey;lastAttempt=0;snapshot=null;seenConnected.clear();
      }
      enabled=next===true;draw();
      if(enabled && (!snapshot||lastAttempt===0))void refresh();
    },
    refresh(){return refresh(true);},
    destroy(){disposed=true;clearInterval(timer);root.remove();},
  };
}
