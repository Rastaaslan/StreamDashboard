import {rm} from 'node:fs/promises';
// Generated output only: removed modules must not survive into a new package.
await rm('dist',{recursive:true,force:true});
