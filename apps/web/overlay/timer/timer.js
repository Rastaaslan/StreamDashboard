const overlay=document.getElementById('overlay');
const kicker=document.getElementById('kicker');
const title=document.getElementById('title');
const subtitle=document.getElementById('subtitle');
const subtitle2=document.getElementById('subtitle2');
const label=document.getElementById('label');
const timer=document.getElementById('timer');
const ornament=document.getElementById('ornament');
const dividerSymbol=document.getElementById('divider-symbol');
const farewell=document.getElementById('farewell');
const embers=document.getElementById('embers');

for(let i=0;i<13;i++){
  const ember=document.createElement('i');
  ember.style.setProperty('--i',i);
  embers.append(ember);
}

const COPY={
  intro:{
    kicker:'LE FEU DE CAMP DE DAM',
    title:'LE CAMP S’ALLUME',
    subtitle:'Installe-toi, le feu prend doucement.',
    subtitle2:'',
    label:'Début du live dans',
    ornament:'✦',
    divider:'◇',
    farewell:''
  },
  pause:{
    kicker:'PETITE PAUSE',
    title:'PAUSE AU CAMP',
    subtitle:'Je reviens, garde une place près du feu.',
    subtitle2:'',
    label:'Retour dans',
    ornament:'◆',
    divider:'◇',
    farewell:''
  },
  end:{
    kicker:'LE FEU DE CAMP DE DAM',
    title:'LE FEU BAISSE',
    subtitle:'Merci d’être passé près du feu.',
    subtitle2:'Le camp se rendort doucement… mais la braise reste là.',
    label:'',
    ornament:'✦',
    divider:'◆',
    farewell:'À TRÈS VITE AUTOUR DU FEU'
  }
};

let state=null;
let ws=null;
let retry=500;
let lastMode='';

const remaining=()=>!state
  ?0
  :state.timer.running&&state.timer.deadline
    ?Math.max(0,Math.ceil((state.timer.deadline-Date.now())/1000))
    :Math.max(0,state.timer.remaining||0);

function render(){
  if(!state)return;
  const mode=state.mode||'idle';
  const copy=COPY[mode];

  if(!copy){
    overlay.className='overlay is-idle';
    overlay.dataset.mode='idle';
    lastMode=mode;
    return;
  }

  const changed=mode!==lastMode;
  lastMode=mode;

  overlay.dataset.mode=mode;
  overlay.className=`overlay is-${mode}`;
  if(changed)requestAnimationFrame(()=>overlay.classList.add('is-activating'));

  kicker.textContent=copy.kicker;
  title.textContent=copy.title;
  subtitle.textContent=copy.subtitle;
  subtitle2.textContent=copy.subtitle2;
  subtitle2.hidden=!copy.subtitle2;
  label.textContent=copy.label;
  ornament.textContent=copy.ornament;
  dividerSymbol.textContent=copy.divider;
  farewell.textContent=copy.farewell;
  farewell.hidden=!copy.farewell;

  if(mode!=='end'){
    const seconds=remaining();
    timer.textContent=`${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;
  }
}

async function snapshot(){
  try{
    const response=await fetch('/api/v1/state',{cache:'no-store'});
    if(response.ok){
      state=await response.json();
      render();
    }
  }catch{/* websocket reconnect handles recovery */}
}

function connect(){
  ws=new WebSocket(`${location.protocol==='https:'?'wss':'ws'}://${location.host}/ws/v1`);
  ws.onopen=()=>{
    retry=500;
    void snapshot();
  };
  ws.onmessage=event=>{
    try{
      const message=JSON.parse(event.data);
      if(message.type==='state.updated'){
        state=message.data;
        render();
      }
    }catch{/* ignore malformed event */}
  };
  ws.onclose=()=>{
    setTimeout(connect,retry);
    retry=Math.min(10000,retry*2);
  };
  ws.onerror=()=>ws.close();
}

setInterval(render,250);
void snapshot();
connect();
