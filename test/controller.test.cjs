const {test}=require('node:test');
const assert=require('node:assert/strict');
const Module=require('node:module');
const original=Module._load;
const uri={joinPath:(_base,...parts)=>parts.join('/')};
const vscode={Uri:uri,workspace:{isTrusted:true},window:{},commands:{executeCommand:async()=>{}},env:{clipboard:{writeText:async()=>{}}}};
Module._load=function(request,...args){if(request==='vscode')return vscode;return original.call(this,request,...args);};
const {WorkspaceController}=require('../out/workspaceController');
Module._load=original;
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r});return {promise,resolve};};
const flush=()=>new Promise(r=>setImmediate(r));
function fakeGit(root='/repo') {
  return {cwd:root,status:async()=>({branch:'main',files:[]}),branches:async()=>[],graph:async()=>[],tags:async()=>[],stashes:async()=>[],worktrees:async()=>[],operationState:async()=>undefined};
}
function attach(git,changed=async()=>{}){
  const sent=[];let receive;
  const webview={options:{},cspSource:'vscode-resource:',asWebviewUri:x=>x,postMessage:async message=>{sent.push(message);},onDidReceiveMessage:cb=>{receive=cb;return {dispose(){}};}};
  const controller=new WorkspaceController({},git,changed);controller.attach(webview);
  return {controller,sent,receive:message=>receive(message),webview};
}
test('controller discards reads from previous repository and late refreshes',async()=>{
  const slow=deferred(),git=fakeGit();git.graph=()=>slow.promise;
  const c=attach(git);c.receive({type:'ready'});await flush();
  c.controller.setGit(fakeGit('/next'));await flush();slow.resolve([{hash:'old'}]);await flush();
  const updates=c.sent.filter(m=>m.type==='data');assert.equal(updates.length,1);assert.equal(updates[0].data.root,'/next');
  assert.ok(c.sent.some(m=>m.type==='reset'));c.controller.dispose();
});
test('controller validates typed search, errors and preserves request identity',async()=>{
  const git=fakeGit();git.detail=async()=>{throw new Error('Cannot load commit')};
  const c=attach(git);c.receive({type:'search',searchBy:'unknown'});await flush();assert.ok(c.sent.some(m=>m.type==='error'));
  c.receive({type:'details',hash:'abc',request:7});await flush();assert.equal(c.sent.at(-1).request,7);
  assert.match(c.webview.html,/default-src 'none'/);assert.doesNotMatch(c.webview.html,/img-src https/);c.controller.dispose();
});
test('mutations are serialized across the bottom panel and editor graph',async()=>{
  const wait=deferred(),git=fakeGit();let commits=0;
  git.commit=async()=>{commits++;await wait.promise;};
  const first=attach(git),second=attach(git);first.receive({type:'commit',message:'first'});await flush();
  second.receive({type:'commit',message:'second'});await flush();assert.equal(commits,1);
  assert.ok(second.sent.some(m=>m.type==='error'&&m.message.includes('正在执行')));
  wait.resolve();await flush();assert.ok(first.sent.some(m=>m.type==='committed'));assert.equal(first.sent.filter(m=>m.type==='busy').at(-1).value,false);
  first.controller.dispose();second.controller.dispose();
});
