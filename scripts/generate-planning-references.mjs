import { app, BrowserWindow } from 'electron';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

app.commandLine.appendSwitch('no-sandbox');
await app.whenReady();
const window = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true } });
await window.loadFile(join(process.cwd(), 'apps/mobile/index.html'));

const images = await window.webContents.executeJavaScript(`(async () => {
  const { renderPlanningCanvas } = await import('./planning-export.js');
  const filters = { twitch:true, google:true, allDay:true, live:true, personal:true, production:true };
  const make = (day, hour, title, game) => ({ id: day + title, title, twitchCategoryId:'42', twitchCategoryName:game, category:'live', source:'TWITCH', desiredPublication:{twitch:true}, startAtUtc:new Date(2026,8,day,hour).toISOString(), endAtUtc:new Date(2026,8,day,hour+2).toISOString() });
  const artwork = async () => new Promise(resolve => { const image = new Image(); image.onload=()=>resolve(image); image.onerror=()=>resolve(null); image.src='./icon-512.png'; });
  const today = [
    make(13,10,'Café, quêtes secondaires et découverte avec le chat','The Elder Scrolls V: Skyrim Special Edition'),
    make(13,14,'Objectif division élite avec les viewers','EA SPORTS FC 26'),
    make(13,20,'Soirée classée : on garde notre calme (normalement)',"Tom Clancy's Rainbow Six Siege"),
    make(13,23,'Finir cette histoire tous ensemble','NieR Replicant ver.1.22474487139...')
  ];
  const week = [
    make(14,19,'Retour à Bordeciel','The Elder Scrolls V: Skyrim Special Edition'), make(14,22,'Après-soirée chill','Just Chatting'),
    make(15,20,'Clubs avec la communauté','EA SPORTS FC 26'), make(17,20,'La route du diamant',"Tom Clancy's Rainbow Six Siege"),
    make(18,21,'Découverte narrative sans spoil','NieR Replicant ver.1.22474487139...'), make(20,17,'Le goûter du dimanche','Just Chatting')
  ];
  const common = { filters, loadArtwork:artwork, noteEnabled:true, noteText:'Et potentiellement d’autres lives à l’improviste 🔥' };
  const a = await renderPlanningCanvas(today,'RASTAASLAN',{...common,period:'today',now:new Date(2026,8,13,8)});
  const b = await renderPlanningCanvas(week,'RASTAASLAN',{...common,period:'next-week',now:new Date(2026,8,7,8)});
  return [a.canvas.toDataURL('image/png'), b.canvas.toDataURL('image/png')];
})()`);

const output = join(process.cwd(), 'tests/fixtures/planning-export');
await mkdir(output, { recursive: true });
for (const [name, data] of [['planning-aujourdhui.png', images[0]], ['planning-semaine.png', images[1]]]) {
  await writeFile(join(output, name), Buffer.from(data.split(',')[1], 'base64'));
}
await window.close();
app.quit();
