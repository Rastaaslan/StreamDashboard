const element=document.getElementById('timer');let state=null,ws=null,retry=500;
const remaining=()=>!state?0:state.timer.running&&state.timer.deadline?Math.max(0,Math.ceil((state.timer.deadline-Date.now())/1000)):Math.max(0,state.timer.remaining||0);
const render=()=>{if(!state)return;const seconds=remaining();element.textContent=`${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;element.classList.toggle('visible',state.timer.running||seconds>0&&state.mode==='live');};
async function snapshot(){try{const response=await fetch('/api/v1/state',{cache:'no-store'});if(response.ok){state=await response.json();render();}}catch{/* websocket reconnect handles recovery */}}
function connect(){ws=new WebSocket(`${location.protocol==='https:'?'wss':'ws'}://${location.host}/ws/v1`);ws.onopen=()=>{retry=500;void snapshot()};ws.onmessage=event=>{try{const message=JSON.parse(event.data);if(message.type==='state.updated'){state=message.data;render();}}catch{/* ignore malformed event */}};ws.onclose=()=>{setTimeout(connect,retry);retry=Math.min(10000,retry*2)};ws.onerror=()=>ws.close();}
setInterval(render,250);void snapshot();connect();
