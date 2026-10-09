const {test}=require('node:test');
const assert=require('node:assert/strict');
const Module=require('node:module');
const original=Module._load;
class Range {constructor(sl,sc,el,ec){this.start={line:sl,character:sc};this.end={line:el,character:ec};}}
let symbols=[],settings={};
const vscode={Range,CodeLens:class {constructor(range,command){this.range=range;this.command=command;}},
  EventEmitter:class {event=()=>{};fire(){};dispose(){};},SymbolKind:{Function:12,Method:5,Constructor:8,Class:4,Interface:10,Enum:9},
  workspace:{getConfiguration:()=>({get:(key,fallback)=>settings[key]??fallback})},commands:{executeCommand:async()=>symbols}};
Module._load=function(request,...args){return request==='vscode'?vscode:original.call(this,request,...args);};
const {GitrismCodeLensProvider,authorsForRange}=require('../out/codeLensProvider');Module._load=original;
const token={isCancellationRequested:false};
const line=(email,hash='a',day=1)=>({hash:hash.repeat(40),author:'Same Name',email,date:`2026-10-0${day}T00:00:00.000Z`,summary:'Commit '+hash});
function document(){return {uri:{scheme:'file',fsPath:'/repo/nested/app.ts',toString:()=>'/repo/nested/app.ts'},version:1,lineCount:10,isDirty:false,isClosed:false};}
function symbol(kind,start,end,children=[]){return {kind,range:new Range(start,0,end,1),selectionRange:new Range(start,0,start,1),children};}
test('authors group by email, exclude uncommitted lines, and use most recent retained commit',()=>{
  const result=authorsForRange([line('a@example','a',1),line('b@example','b',2),line('A@example','c',3),line('a@example','0',4)],0,3);
  assert.equal(result.authors.length,2);assert.equal(result.authors[0].lines,2);assert.equal(result.latest.hash,'c'.repeat(40));assert.equal(result.uncommitted,1);
});
test('CodeLens uses nested language symbols, longest repository root, cache and URI-aware links',async()=>{
  settings={};symbols=[symbol(vscode.SymbolKind.Class,1,8,[symbol(vscode.SymbolKind.Method,3,5)])];
  let reads=0;const repo={cwd:'/repo/nested',blame:async()=>{reads++;return Array.from({length:10},(_,i)=>line(i===4?'b@example':'a@example',i===4?'b':'a',i===4?2:1));}};
  const provider=new GitrismCodeLensProvider(()=>[{cwd:'/repo',blame:async()=>{throw new Error('wrong repo');}},repo]),doc=document();
  let lenses=await provider.provideCodeLenses(doc,token);
  assert.equal(lenses.length,5);assert.deepEqual(lenses.filter(l=>l.command.command==='gitrism.showCommit').map(l=>l.range.start.line),[1,3]);
  assert.equal(lenses[0].command.arguments[1],'/repo/nested');assert.equal(lenses.at(-1).command.arguments[0],doc.uri);
  const authors=lenses.find(l=>l.command.command==='gitrism.showCodeAuthors').command.arguments[0];assert.equal(authors.length,2);
  await provider.provideCodeLenses(doc,token);assert.equal(reads,1);
  provider.invalidate();await provider.provideCodeLenses(doc,token);assert.equal(reads,2);provider.dispose();
});
test('CodeLens falls back to file attribution, supports flat symbols, and skips dirty/disabled/oversized/cancelled files',async()=>{
  settings={};symbols=[];const provider=new GitrismCodeLensProvider(()=>[{cwd:'/repo',blame:async()=>[line('a@example')]}]),doc=document();
  let lenses=await provider.provideCodeLenses(doc,token);assert.equal(lenses.length,3);assert.equal(lenses[0].range.start.line,0);
  symbols=[{kind:vscode.SymbolKind.Function,location:{uri:doc.uri,range:new Range(0,0,1,1)}}];
  assert.equal((await provider.provideCodeLenses(doc,token)).length,3);
  doc.isDirty=true;assert.deepEqual(await provider.provideCodeLenses(doc,token),[]);doc.isDirty=false;
  settings={enabled:false};assert.deepEqual(await provider.provideCodeLenses(doc,token),[]);
  settings={maxLines:5};assert.deepEqual(await provider.provideCodeLenses(doc,token),[]);
  settings={};assert.deepEqual(await provider.provideCodeLenses(doc,{isCancellationRequested:true}),[]);provider.dispose();
});
test('CodeLens discards blame after document changes or invalidation during a pending request',async()=>{
  settings={};symbols=[];let resolve;const provider=new GitrismCodeLensProvider(()=>[{cwd:'/repo',blame:()=>new Promise(r=>resolve=r)}]),doc=document();
  let pending=provider.provideCodeLenses(doc,token);await new Promise(r=>setImmediate(r));doc.version++;resolve([line('a@example')]);assert.deepEqual(await pending,[]);
  pending=provider.provideCodeLenses(doc,token);await new Promise(r=>setImmediate(r));provider.invalidate();resolve([line('a@example')]);assert.deepEqual(await pending,[]);provider.dispose();
});
