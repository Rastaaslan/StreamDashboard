import {basename,dirname,join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {readFile} from 'node:fs/promises';
import {AudioReceiptSqlite} from '../../apps/server/src/streamcockpit-audio-receipts-sqlite.js';
import type {AudioReceipt,AudioReceiptContext} from '../../apps/server/src/streamcockpit-audio-receipts.js';
const [mode,argument]=process.argv.slice(2),root=resolve(argument??'');
if(dirname(root)!==resolve(tmpdir())||!basename(root).startsWith('sc3-audio-receipts-'))throw Error('TEST_DIRECTORY_REQUIRED');
const input=JSON.parse(await readFile(join(root,'test-input.json'),'utf8')) as {id:string;context:AudioReceiptContext;receipt:AudioReceipt};
const store=new AudioReceiptSqlite(join(root,'streamcockpit-mixer-receipts.sqlite'));
if(mode==='pending'||mode==='confirmed'){
 if(!store.reserve(input.id,input.context,input.receipt.change))throw Error('ALREADY_RESERVED');
 if(mode==='confirmed')store.complete(input.id,input.context,input.receipt);
 // Deliberate fixture-only abrupt process exit, never an installed application.
 process.exit(71);
}else if(mode==='read'){
 const saved=store.read(input.id,input.context.actor,input.context.authority);
 console.log(JSON.stringify({saved,repeatAccepted:store.reserve(input.id,input.context,input.receipt.change)}));
}else throw Error('UNKNOWN_TEST_MODE');
