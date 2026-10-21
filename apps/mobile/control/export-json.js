export async function exportJSON(value,name,{native=globalThis.StreamDashboardNative,document=globalThis.document,urls=globalThis.URL}={}){
 const text=JSON.stringify(value,null,2);
 if(!text||text.length>8*1024*1024)throw Error('Export trop volumineux (8 Mo maximum).');
 if(native?.shareDocument){const error=await native.shareDocument(text,name);if(error)throw Error(error);return;}
 if(native?.isAndroid?.())throw Error('Mettez à jour Android pour exporter les sauvegardes JSON.');
 const url=urls.createObjectURL(new Blob([text],{type:'application/json'})),link=document.createElement('a');
 link.href=url;link.download=name;link.click();setTimeout(()=>urls.revokeObjectURL(url),1000);
}
