export function createDiscoveryUI({scan,modal,esc,choose,localId}){
 let results=[];
 const valid=value=>{
  try{const url=new URL(value.endpoint);return value.id!==localId()&&/^[-\w]{1,100}$/.test(value.id)&&typeof value.name==='string'&&value.name.length<=80&&['windows','android'].includes(value.platform)&&url.protocol==='https:'&&/^\d+\.\d+\.\d+\.\d+$/.test(url.hostname)&&url.hostname.split('.').every(part=>Number(part)<=255)&&/^(10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(url.hostname)&&url.origin===value.endpoint;}catch{return false;}
 };
 async function task(name,button){
  if(name==='discover-devices'){
   results=[];modal('<h2>Appareils sur le réseau local</h2><p data-discovery-results role="status">Recherche en cours…</p><p>Activez le partage réseau sur les appareils à trouver. Un réseau invité ou un pare-feu peut empêcher leur détection.</p><button class="secondary" data-task="connection">Saisir une adresse ou un lien</button>');
   const host=document.querySelector('[data-discovery-results]');
   try{const response=await scan();if(!host?.isConnected)return true;
    results=(Array.isArray(response?.devices)?response.devices:[]).filter(valid).slice(0,64);
    host.innerHTML=results.length?results.map((value,index)=>`<section><b>${esc(value.name)}</b> · ${esc(value.platform)}<br>${esc(value.endpoint)}<br><button type="button" data-task="discover-select" data-index="${index}">Associer cet appareil</button></section>`).join('')+'<p>Ces annonces ne prouvent pas l’identité des appareils. Le code et l’empreinte doivent être vérifiés sur l’appareil choisi.</p>':'Aucun appareil détecté. Vous pouvez toujours utiliser son adresse ou son lien d’association.';
   }catch(error){if(host?.isConnected)host.textContent=error.message||'Recherche indisponible. Utilisez le lien d’association.';}
   return true;
  }
  if(name==='discover-select'){
   const value=results[Number(button?.dataset.index)];if(!value||!valid(value))throw Error('Relancez la recherche des appareils.');
   // No trust pin or credential is supplied by an unauthenticated UDP hint.
   choose(value.endpoint);return true;
  }
  return false;
 }
 return {task};
}
