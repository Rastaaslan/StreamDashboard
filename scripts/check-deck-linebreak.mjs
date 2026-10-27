import {chromium} from '@playwright/test';
import express from 'express';
import {readFile, mkdir} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {deckActionMarkup, deckActionParts} from '../apps/mobile/control/deck-action-markup.js';

const root=path.resolve('apps/mobile');
const samples=[
  {label:'Micro',status:'Micro ouvert',shortcut:'Control+Alt+Shift+F6',icon:'♩'},
  {label:'Jeu',status:'À l’écran',shortcut:'Control+Alt+Shift+F4',icon:'▣'},
  {label:'Pause',status:'PAUSE',shortcut:'Control+Alt+Shift+F2',icon:'▣'},
  {label:'Discussion',status:'CHATTING',shortcut:'Control+Alt+Shift+F3',icon:'▣'},
  {label:'Sauvegarder un clip',status:'Dernières 20 s',shortcut:'Control+Alt+Shift+F5',icon:'✂'},
  {label:'Fin',status:'FIN',shortcut:'Control+Alt+Shift+F1',icon:'■'},
  {label:'Un bouton avec un titre volontairement très long pour tester la lisibilité',status:'Disponible sur FIXE',shortcut:'Control+Alt+Shift+F8',icon:'✨'},
  {label:'NomTrèsTrèsTrèsTrèsLongSansEspacesPourUnBouton',status:'Régie connectée',shortcut:'Control+Alt+Shift+F9',icon:'🌟'},
];
assert.deepEqual(deckActionParts(samples[0]),{title:'Micro',state:'ouvert',shortcut:'M / F6',icon:'♩'});
assert.equal(deckActionParts(samples[2]).state,'');
assert.equal(deckActionParts({label:'▣ Jeu',icon:'▣'}).title,'Jeu');
const app=express();
app.use('/mobile',express.static(root));
const shell=await readFile(path.join(root,'control/index.html'),'utf8');
const slot='<main id="content" tabindex="-1"></main>';
const buttons=samples.map((item,index)=>'<button type="button" class="sd-action-pad" data-index="'+index+'">'+deckActionMarkup(item)+'</button>').join('');
const content='<main id="content" tabindex="-1"><div class="mobile-pane-layout" data-mobile-pane-group="deck">'
  +'<section class="mobile-pane-screen mobile-pane-deck" data-mobile-pane-group="deck" data-mobile-pane="actions">'
  +'<div class="mobile-spontaneous-row"><button type="button">⚡ Live spontané</button><small>Aucun événement créé dans le planning.</small></div>'
  +'<p class="small muted">Les commandes d’arrêt conservent leur confirmation. Les macros restent liées à leur destination.</p>'
  +'<div class="mobile-pane-action-grid">'+buttons+'</div>'
  +'<div class="mobile-pane-actions"><button type="button">Modifier mes boutons et macros</button></div>'
  +'</section></div></main>';
const compactDoc=shell.replace(/<script[^>]*src="control\.js"[^>]*><\/script>/g,'')
  .replace('<head>','<head><base href="/mobile/control/">')
  .replace(slot,content);
const desktopDoc=shell.replace(/<script[^>]*src="control\.js"[^>]*><\/script>/g,'')
  .replace('<head>','<head><base href="/mobile/control/">')
  .replace(slot,'<main id="content" tabindex="-1"><div class="deck">'+buttons+'</div></main>');
app.get('/',(_req,res)=>res.type('text/html').send(compactDoc));
app.get('/desktop',(_req,res)=>res.type('text/html').send(desktopDoc));
const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
const report=[];
try{
  for(const width of [320,360,390,430,768,1366]){
    const isCompact=width!==1366;
    const page=await browser.newPage({viewport:{width,height:800},deviceScaleFactor:1});
    await page.goto(origin+(isCompact?'/':'/desktop'));
    await page.evaluate(compact=>{
      document.documentElement.className=compact?'compact-app mobile-panes-active simple-nav':'';
      document.querySelector('#connection').textContent='Régie connectée · copie locale à jour';
    },isCompact);
    await page.evaluate(()=>document.fonts.ready);
    const analysis=await page.evaluate(()=>{
      const rect=e=>e.getBoundingClientRect();
      const descendants=[...document.querySelectorAll('button.sd-action-pad')];
      const stats=descendants.map((button,index)=>{
        const parts=[...button.children];
        const br=rect(button);
        const cr=parts.map(child=>({tag:child.className,top:rect(child).top,bottom:rect(child).bottom,left:rect(child).left,right:rect(child).right,height:rect(child).height,scrollWidth:child.scrollWidth,clientWidth:child.clientWidth,whiteSpace:getComputedStyle(child).whiteSpace}));
        return {index,top:br.top,bottom:br.bottom,width:br.width,scrollWidth:button.scrollWidth,clientWidth:button.clientWidth,children:cr};
      });
      const connection=document.querySelector('#connection');
      const connectionStyle=getComputedStyle(connection);
      return {viewport:document.documentElement.clientWidth,
        pageWidth:Math.max(document.body.scrollWidth,document.documentElement.scrollWidth),
        connection:{whiteSpace:connectionStyle.whiteSpace,clientWidth:connection.clientWidth,scrollWidth:connection.scrollWidth,height:connection.getBoundingClientRect().height},
        buttons:stats,
        gridColumns:getComputedStyle(document.querySelector('.mobile-pane-action-grid')||document.querySelector('.deck')).gridTemplateColumns};
    });
    assert.equal(analysis.buttons.length,samples.length,'Missing buttons width='+width);
    assert.ok(analysis.pageWidth<=analysis.viewport+2, 'Horizontal page overflow at '+width+': '+JSON.stringify({pageWidth:analysis.pageWidth,viewport:analysis.viewport}));
    for(const b of analysis.buttons){
      assert.ok(b.scrollWidth<=b.clientWidth+2,'Button content overflow '+width+' index='+b.index);
      for(let i=0;i<b.children.length;i++){
        const child=b.children[i];
        assert.ok(child.scrollWidth<=child.clientWidth+3,'Text overflow '+width+' i='+b.index+' '+child.tag);
        assert.ok(child.top>=b.top-1 && child.bottom<=b.bottom+1,'Clipped vertical child '+width+' '+b.index+' '+child.tag);
        if(i>0)assert.ok(child.top>=b.children[i-1].bottom+2,
          'Concatenated or overlapping rows at '+width+' index='+b.index+' '+b.children[i-1].tag+'/'+child.tag);
        if(child.tag==='sd-action-pad-shortcut')assert.equal(child.whiteSpace,'nowrap','Shortcut split at '+width);
      }
    }
    if(isCompact){
      assert.equal(analysis.connection.whiteSpace,'normal','Banner should wrap at '+width);
      assert.ok(analysis.connection.scrollWidth<=analysis.connection.clientWidth+2,'Banner overflow at '+width);
      assert.ok(analysis.connection.height>13&&analysis.connection.height<33,'Banner line clamp at '+width);
      assert.ok(analysis.buttons[0].width<width*.58, 'Expected two-column mobile buttons at '+width);
      const end=page.locator('.mobile-pane-actions > button');
      await end.scrollIntoViewIfNeeded();
      assert.ok(await end.isVisible(),'Bottom control hidden at '+width);
    }
    if(width===320||width===390||width===1366){
      const dir=path.resolve('test-results/deck-action-layout');
      await mkdir(dir,{recursive:true});
      await page.evaluate(()=>window.scrollTo(0,0));
      await page.screenshot({path:path.join(dir,'layout-'+width+'.png'),fullPage:true});
    }
    report.push({width,columns:analysis.gridColumns,buttons:analysis.buttons.length,overflow:analysis.pageWidth-analysis.viewport});
    await page.close();
  }
  console.log('LAYOUT_CHECKS_OK');
  console.log(JSON.stringify(report,null,2));
}finally{
 await browser.close();await new Promise(resolve=>server.close(resolve));
}
