import ts from 'typescript';
import path from 'node:path';
import fs from 'node:fs';
const files=new Set();
function walk(file,includeDynamic){
 if(files.has(file))return;files.add(file);const text=fs.readFileSync(file,'utf8'),tree=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS),links=[];
 const visit=node=>{if((ts.isImportDeclaration(node)||ts.isExportDeclaration(node))&&node.moduleSpecifier&&ts.isStringLiteral(node.moduleSpecifier))links.push(node.moduleSpecifier.text);if(includeDynamic&&ts.isCallExpression(node)&&node.expression.kind===ts.SyntaxKind.ImportKeyword&&ts.isStringLiteral(node.arguments[0]))links.push(node.arguments[0].text);ts.forEachChild(node,visit);};visit(tree);
 for(const link of links)if(link.startsWith('.'))walk(path.normalize(path.join(path.dirname(file),link)),includeDynamic);
}
const modules=[];for(const entry of ['apps/mobile/control/control.js','apps/mobile/control/native-executor.js','apps/mobile/shared/uuid.js'])for(const includeDynamic of [false,true]){if(!fs.existsSync(entry))continue;files.clear();walk(entry,includeDynamic);modules.push({entry,includeDynamic,files:files.size,bytes:[...files].reduce((sum,file)=>sum+fs.statSync(file).size,0)});}
if(process.argv.includes('--graph-only')){console.log(JSON.stringify({modules},null,2));process.exit(0);}
const publicFiles=JSON.parse(fs.readFileSync('.build/public/manifest.json','utf8')).files;
const result={modules,publicAssets:{count:publicFiles.length,bytes:publicFiles.reduce((sum,file)=>sum+fs.statSync('.build/public/'+file.path).size,0),declarations:publicFiles.filter(f=>f.path.endsWith('.d.ts')).length},mainFiles:Object.fromEntries(['apps/mobile/control/control.js','apps/mobile/control/settings-view.js','apps/server/src/index.ts','android/app/src/main/java/com/rastaaslan/streamdashboard/remote/ProviderBridge.java'].map(file=>[file,fs.statSync(file).size]))};
console.log(JSON.stringify(result,null,2));
