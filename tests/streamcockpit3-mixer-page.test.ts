import {expect,it,vi} from 'vitest';
// @ts-expect-error Browser module without generated declarations.
import {mountMixerPage} from '../apps/mobile/control/streamcockpit-mixer-page.js';

class E {
  children:E[]=[];textContent='';removed=false;attrs:Record<string,string>={};
  ownerDocument={createElement:(_tag:string)=>new E()};
  setAttribute(name:string,value:string){this.attrs[name]=value;}
  append(...nodes:E[]){this.children.push(...nodes);}
  replaceChildren(...nodes:E[]){this.children=[...nodes];}
  remove(){this.removed=true;}
}
it('never calls host while offline and provides a real read-only mixer in Plus',async()=>{
  const offlineRoot=new E();
  const request=vi.fn(async()=>({}));
  const offline=mountMixerPage(offlineRoot,{online:false,request});
  expect(request).not.toHaveBeenCalled();
  expect(offlineRoot.children[0].textContent).toContain('Fixe indisponible');
  offline.destroy();expect(offlineRoot.children[0].removed).toBe(true);
  const root=new E();
  request.mockResolvedValueOnce({
    schemaVersion:1,readOnly:true,owner:'FIXE',revision:'obs:2:1',
    errors:[],outputs:[],
    sources:[{id:'mic',name:'DJI Mic',gain:{state:'known',value:0.7},
      mute:{state:'known',value:false},level:{state:'unknown',reason:'not-observed'},
      stream:{state:'unknown',reason:'not-observed'},monitor:{state:'unknown',reason:'not-observed'},
      vod:{state:'unknown',reason:'not-observed'},device:{state:'unknown',reason:'not-observed'}}],
  });
  const page=mountMixerPage(root,{online:true,request});
  await Promise.resolve();await Promise.resolve();
  expect(request).toHaveBeenCalledWith('/api/v1/streamcockpit-mixer');
  const table=root.children[1].children[1];
  expect(table.children[1].children[0].textContent).toBe('DJI Mic');
  expect(table.children[1].children[1].textContent).toBe('0.7');
  expect(table.children[1].children[6].textContent).toContain('Inconnu');
  page.unavailable();
  expect(root.children[0].textContent).toContain('déconnecté');
  expect(root.children[1].removed).toBe(true); // entire table section is detached on disconnect
  page.destroy();
});
