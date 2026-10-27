import {expect,it} from 'vitest';
import path from 'node:path';
import os from 'node:os';
import {desktopUserData} from '../apps/desktop/src/qa-profile.js';
it('isolates explicit test profiles before the instance lock and refuses real directories',()=>{
 const base=path.resolve(os.tmpdir()),root=path.join(base,'streamdashboard-qa-ab123'),normal='/stable/profile';
 expect(desktopUserData(normal,[],'test',base)).toBe(normal);
 expect(desktopUserData(normal,['--qa-profile='+root],'test',base)).toBe(path.join(root,'StreamDashboard-Next'));
 for(const value of ['relative',path.join(base,'user-profile'),path.join(root,'nested'),path.parse(base).root])expect(()=>desktopUserData(normal,['--qa-profile='+value],'test',base)).toThrow();
 expect(()=>desktopUserData(normal,['--qa-profile='+root],'production',base)).toThrow();
});
