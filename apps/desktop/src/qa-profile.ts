import path from 'node:path';
import os from 'node:os';

/** Windows' native AppData lookup need not honor an APPDATA environment override.
 * A test must select its temporary profile before acquiring the instance lock. */
export function desktopUserData(defaultDirectory:string,args=process.argv,environment=process.env.NODE_ENV,temporary=os.tmpdir()) {
  const flag=args.find(value=>value.startsWith('--qa-profile='));
  if(!flag)return defaultDirectory;
  const root=flag.slice('--qa-profile='.length);
  if(environment!=='test'||!path.isAbsolute(root)||path.dirname(root)!==path.resolve(temporary)||!/^streamdashboard-qa-[a-z0-9-]+$/i.test(path.basename(root)))throw new Error('Profil de test temporaire invalide.');
  return path.join(root,'StreamDashboard-Next');
}
