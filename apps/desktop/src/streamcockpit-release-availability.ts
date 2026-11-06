/** Availability is read-only. Electron/Squirrel checkForUpdates downloads and
 * may apply on the next launch; it cannot represent explicit maintenance consent.
 * The existing native planner still owns verification, preparation and install. */
function version(value:string):number[]|undefined{
 const m=/^(?:v)?(\d+)\.(\d+)\.(\d+)(?:-(alpha|rc)\.(\d+))?$/.exec(value);
 if(!m)return;
 const values=[Number(m[1]),Number(m[2]),Number(m[3]),m[4]==='alpha'?0:m[4]==='rc'?1:2,Number(m[5]||0)];
 return values.every(Number.isSafeInteger)?values:undefined;
}
export function isNewerWindowsRelease(candidate:string,current:string):boolean{
 const a=version(candidate),b=version(current);if(!a||!b)return false;
 for(let i=0;i<a.length;i++){if(a[i]!==b[i])return a[i]!>b[i]!}
 return false;
}
export async function readAvailableWindowsRelease(current:string,fetchApi:typeof fetch=fetch):Promise<string|undefined>{
 if(!version(current))return;
 const response=await fetchApi('https://api.github.com/repos/Rastaaslan/StreamDashboard/releases/latest',{
  method:'GET',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(5000),
  headers:{Accept:'application/vnd.github+json'},
 });
 if(response.status===404)return;
 if(!response.ok)throw Error('SC3_RELEASE_AVAILABILITY_UNAVAILABLE');
 const text=await response.text();if(text.length>262144)throw Error('SC3_RELEASE_METADATA_TOO_LARGE');
 const data=JSON.parse(text);
 if(data?.draft!==false||typeof data.tag_name!=='string'||!isNewerWindowsRelease(data.tag_name,current))return;
 return data.tag_name.replace(/^v/,'');
}
