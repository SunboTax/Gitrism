const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { spawn } = require('node:child_process');

test('browser: CSP, graph/details, tabs, draft persistence, searches, timeline and responsive themes', {timeout:60000}, async t => {
  const chromePath=process.env.GITRISM_CHROME || '/usr/bin/google-chrome';
  try { await fs.access(chromePath); } catch { t.skip('Chrome is optional; set GITRISM_CHROME to enable browser verification'); return; }
  const hash=n=>String(n).repeat(40);
  const commits=[
    {hash:hash(1),parents:[hash(2),hash(3)],author:'Gitrism Tester',date:'2026-10-05T08:00:00Z',refs:'HEAD -> main, tag: v0.1.0',subject:'Merge feature into main'},
    {hash:hash(2),parents:[hash(4)],author:'Gitrism Tester',date:'2026-10-04T08:00:00Z',refs:'',subject:'Improve repository workspace'},
    {hash:hash(3),parents:[hash(4)],author:'Chen',date:'2026-10-03T08:00:00Z',refs:'feature/graph',subject:'Draw topology from commit parents'},
    {hash:hash(4),parents:[],author:'Gitrism Tester',date:'2026-10-01T08:00:00Z',refs:'',subject:'Initial <img src=x onerror=alert(1)> commit'}
  ];
  const data={root:'/workspace/project',name:'project',status:{branch:'main',upstream:'origin/main',ahead:1,behind:0,staged:1,changed:1,untracked:1,conflicted:0,files:[{path:'src/app.ts',index:'M',working:'M',conflict:false},{path:'notes.md',index:'?',working:'?',conflict:false}]},
    branches:[{name:'main',current:true,remote:'origin/main',hash:hash(1)},{name:'feature/graph',current:false,hash:hash(3)},{name:'origin/main',isRemote:true,hash:hash(2)}],
    commits,tags:[{name:'v0.1.0',date:commits[0].date,subject:'Release',hash:hash(1)}],stashes:[{ref:'stash@{0}',hash:hash(3),subject:'WIP workspace changes',date:commits[0].date}],worktrees:[{path:'/workspace/project',branch:'main',hash:hash(1)},{path:'/workspace/project-feature',branch:'feature/graph',hash:hash(3)}],hasMore:true,options:{},limit:100};
  const details=Object.fromEntries(commits.map(c=>[c.hash,{...c,email:'gitrism@example.invalid',message:c.subject,files:[{path:'src/app.ts',status:'M'},{path:'resources/workspace.css',status:'A'}],stats:'2 files changed, 84 insertions(+), 12 deletions(-)'}]));
  const theme=':root{--vscode-font-family:system-ui;--vscode-font-size:13px;--vscode-foreground:#ddd;--vscode-editor-background:#1e1e1e;--vscode-sideBar-background:#252526;--vscode-panel-border:#444;--vscode-input-background:#333;--vscode-input-foreground:#ddd;--vscode-descriptionForeground:#999;--vscode-charts-blue:#75baff;--vscode-textLink-foreground:#75baff}@media(prefers-color-scheme:light){:root{--vscode-foreground:#333;--vscode-editor-background:#fff;--vscode-sideBar-background:#f5f5f5;--vscode-panel-border:#ddd;--vscode-input-background:#eee;--vscode-input-foreground:#333;--vscode-descriptionForeground:#666;--vscode-charts-blue:#176abb;--vscode-textLink-foreground:#176abb}}';
  const bridge=`const fixture=${JSON.stringify(data)}, details=${JSON.stringify(details)}; let saved; window.sent=[];window.deliver=m=>window.dispatchEvent(new MessageEvent('message',{data:m}));window.acquireVsCodeApi=()=>({getState:()=>saved,setState:s=>{saved=structuredClone(s)},postMessage:m=>{sent.push(m);setTimeout(()=>{if(m.type==='ready'||m.type==='refresh')deliver({type:'data',data:fixture});if(m.type==='details')deliver({type:'details',request:m.request,detail:details[m.hash]});if(m.type==='search'){fixture.options={query:m.query,searchBy:m.searchBy,ref:m.ref,file:m.file};deliver({type:'data',data:fixture})}if(m.type==='compare')deliver({type:'comparison',request:m.request,comparison:{from:m.from,to:m.to,ahead:1,behind:0,files:[{status:'M',path:'src/app.ts'}],stats:'1 file changed',commits:fixture.commits.slice(0,1)}});if(m.type==='timelineHistory')deliver({type:'timelineHistory',request:m.request,file:m.file,commits:fixture.commits.slice(1)})},0)}});`;
  const html='<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'self\'; script-src \'nonce-test\';"><link rel="stylesheet" href="/theme.css"><link rel="stylesheet" href="/workspace.css"><link rel="stylesheet" href="/timeline.css"></head><body><main id="app"></main><div id="toast" role="status" hidden></div><script nonce="test" src="/bridge.js"></script><script nonce="test" src="/graphLayout.js"></script><script nonce="test" src="/workspace.js"></script></body></html>';
  const rebaseBridge=`const originalApi=acquireVsCodeApi;window.acquireVsCodeApi=()=>{const api=originalApi(),post=api.postMessage;api.postMessage=m=>{post(m);if(m.type==='rebasePlan')setTimeout(()=>deliver({type:'rebasePlan',request:m.request,plan:{base:m.ref,head:fixture.commits[0].hash,branch:'main',commits:fixture.commits.slice(1).reverse()}}),0)};return api};`;
  const server=http.createServer(async(req,res)=>{
    try {
      const name=new URL(req.url,'http://localhost').pathname;
      if(name==='/') {res.setHeader('content-type','text/html');res.end(html);return;}
      if(name==='/bridge.js'){res.setHeader('content-type','text/javascript');res.end(bridge+rebaseBridge);return;}
      if(name==='/theme.css'){res.setHeader('content-type','text/css');res.end(theme);return;}
      if(!['/workspace.css','/timeline.css','/workspace.js','/graphLayout.js'].includes(name)){res.writeHead(404);res.end();return;}
      res.setHeader('content-type',name.endsWith('.js')?'text/javascript':'text/css');res.end(await fs.readFile(path.join(__dirname,'../resources',name)));
    }catch(error){res.writeHead(500);res.end(String(error));}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>server.close());
  const profile=await fs.mkdtemp(path.join(os.tmpdir(),'gitrism-browser-'));t.after(()=>fs.rm(profile,{recursive:true,force:true}));
  const chrome=spawn(chromePath,['--headless','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{stdio:['ignore','ignore','pipe']});
  t.after(async()=>{chrome.kill('SIGTERM');await new Promise(resolve=>chrome.exitCode!==null?resolve():chrome.once('exit',resolve));});
  const endpoint=await new Promise((resolve,reject)=>{
    let buffer='';const timer=setTimeout(()=>reject(new Error('Chrome did not expose DevTools')),15000);
    chrome.stderr.on('data',chunk=>{buffer+=chunk;const match=buffer.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(match){clearTimeout(timer);resolve(match[1]);}});
    chrome.once('error',error=>{clearTimeout(timer);reject(error);});
  });
  const debugUrl=new URL(endpoint), targets=await(await fetch('http://'+debugUrl.host+'/json/list')).json();
  const ws=new WebSocket(targets.find(target=>target.type==='page').webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});t.after(()=>ws.close());
  let id=0;const pending=new Map(),errors=[];
  ws.addEventListener('message',event=>{const m=JSON.parse(event.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(m.error):p.resolve(m.result);}if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.text);if(m.method==='Log.entryAdded'&&m.params.entry.level==='error')errors.push(m.params.entry.text);});
  const call=(method,params={})=>new Promise((resolve,reject)=>{const n=++id;pending.set(n,{resolve,reject});ws.send(JSON.stringify({id:n,method,params}));});
  const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
  const until=async expression=>{for(let i=0;i<80;i++){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,25));}throw new Error('Condition did not become true: '+expression);};
  const click=async selector=>{await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);};
  await call('Runtime.enable');await call('Log.enable');await call('Page.enable');
  await call('Emulation.setDeviceMetricsOverride',{width:1440,height:780,deviceScaleFactor:1,mobile:false});
  await call('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:'dark'}]});
  await call('Page.navigate',{url:'http://127.0.0.1:'+server.address().port+'/'});
  await until("document.querySelectorAll('.commit-row').length===4");
  assert.equal(await evaluate("document.querySelectorAll('.commit-subject img').length"),0);
  assert.equal(await evaluate("document.querySelectorAll('img').length"),0);
  await click('.commit-row');await until("document.querySelector('.detail-header h2')?.textContent==='Merge feature into main'");
  await click('.file-diff');assert.equal(await evaluate("sent.at(-1).type"),'diff');
  const output=process.env.GITRISM_SCREENSHOTS || '/tmp/gitrism-preview';await fs.mkdir(output,{recursive:true});
  await fs.writeFile(path.join(output,'dark.png'),Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
  await click('[data-tab="changes"]');
  await evaluate("const draft=document.getElementById('draft');draft.value='Keep draft after refresh';draft.dispatchEvent(new Event('input',{bubbles:true}))");
  await click('[data-action="refresh"]');await until("document.getElementById('draft')?.value==='Keep draft after refresh'");
  await click('[data-action="stage"]');assert.equal(await evaluate("sent.at(-1).type"),'stage');
  await click('[data-tab="graph"]');await evaluate("document.getElementById('search-by').value='author';document.getElementById('search').value='Chen'");await click('[data-action="search"]');
  await until("sent.some(m=>m.type==='search'&&m.searchBy==='author'&&m.query==='Chen')");
  for(const tab of ['branches','tags','stashes','worktrees','compare']){await click('[data-tab="'+tab+'"]');assert.ok(await evaluate("document.querySelector('.content h2')?.textContent"));}
  await evaluate("document.getElementById('compare-from').value='main';document.getElementById('compare-to').value='feature/graph'");await click('[data-action="compare"]');await until("document.querySelector('.comparison-summary')!==null");
  await click('[data-tab="timeline"]');await evaluate("document.getElementById('timeline-file').value='src/app.ts'");await click('[data-action="timelineSearch"]');await until("document.querySelectorAll('.timeline-list .timeline-commit').length===3");
  await click('[data-tab="graph"]');assert.equal(await evaluate("document.querySelectorAll('.commit-row').length"),4);
  await click('[data-tab="rebase"]');await evaluate("document.getElementById('rebase-base').value='HEAD~3'");await click('[data-action="rebasePlan"]');await until("document.querySelectorAll('.rebase-step').length===3");
  assert.equal(await evaluate("document.querySelector('[data-action=applyRebase]').disabled"),true);
  await evaluate("fixture.status.files=[];fixture.status.staged=0;fixture.status.changed=0;fixture.status.untracked=0;deliver({type:'data',data:fixture})");
  await click('[data-action="moveRebase"][data-index="2"][data-direction="-1"]');
  await evaluate("const action=document.querySelector('[data-rebase-index=\"1\"]');action.value='fixup';action.dispatchEvent(new Event('change',{bubbles:true}))");await click('[data-action="applyRebase"]');
  assert.equal(await evaluate("sent.at(-1).type"),'applyRebase');assert.equal(await evaluate("sent.at(-1).steps[1].action"),'fixup');
  await fs.writeFile(path.join(output,'rebase.png'),Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
  await click('[data-tab="graph"]');
  await call('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:'light'}]});
  await fs.writeFile(path.join(output,'light.png'),Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
  await call('Emulation.setDeviceMetricsOverride',{width:480,height:740,deviceScaleFactor:1,mobile:false});
  assert.ok(await evaluate("document.documentElement.scrollWidth<=480"));
  await fs.writeFile(path.join(output,'narrow.png'),Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
  assert.deepEqual(errors,[],'No script or CSP errors should occur');
});
