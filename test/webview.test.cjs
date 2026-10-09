const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { spawn } = require('node:child_process');

for (const locale of ['en', 'zh-CN', 'zh-TW']) test('browser ['+locale+']: CSP, graph/details, tabs, draft persistence, searches, timeline and responsive themes', {timeout:60000}, async t => {
  const {createTranslator}=require('../resources/i18n');
  const messages=locale==='en'?{}:require('../resources/locales/'+locale.toLowerCase()+'.json');
  const translate=createTranslator(messages);
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
  const bridge=`const fixture=${JSON.stringify(data)}, details=${JSON.stringify(details)}; let saved; window.sent=[];window.deliver=m=>window.dispatchEvent(new MessageEvent('message',{data:m}));window.acquireVsCodeApi=()=>({getState:()=>saved,setState:s=>{saved=structuredClone(s)},postMessage:m=>{sent.push(m);setTimeout(()=>{if(m.type==='ready'||m.type==='refresh'){deliver({type:'data',data:fixture});deliver({type:'activity',root:fixture.root,activity:{email:'gitrism@example.invalid',timestamps:[Math.floor(Date.now()/1000)-86400,Math.floor(Date.now()/1000)-86400,Math.floor(Date.now()/1000)-86400*3]}})}if(m.type==='details')deliver({type:'details',request:m.request,detail:details[m.hash]});if(m.type==='search'){fixture.options={...m};delete fixture.options.type;deliver({type:'data',data:fixture})}if(m.type==='compare')deliver({type:'comparison',request:m.request,comparison:{from:m.from,to:m.to,ahead:1,behind:0,files:[{status:'M',path:'src/app.ts'}],stats:'1 file changed',commits:fixture.commits.slice(0,1)}});if(m.type==='timelineHistory')deliver({type:'timelineHistory',request:m.request,file:m.file,commits:fixture.commits.slice(1)})},0)}});`;
  const localization=JSON.stringify({locale,messages}).replace(/</g,'\\u003c');
  const html='<!DOCTYPE html><html lang="'+locale+'"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'self\'; script-src \'nonce-test\';"><link rel="stylesheet" href="/theme.css"><link rel="stylesheet" href="/workspace.css"><link rel="stylesheet" href="/timeline.css"></head><body><main id="app"></main><div id="toast" role="status" hidden></div><script nonce="test" src="/bridge.js"></script><script id="gitrism-localization" type="application/json" nonce="test">'+localization+'</script><script nonce="test" src="/i18n.js"></script><script nonce="test" src="/graphLayout.js"></script><script nonce="test" src="/activity.js"></script><script nonce="test" src="/workspace.js"></script></body></html>';
  const rebaseBridge=`const originalApi=acquireVsCodeApi;window.acquireVsCodeApi=()=>{const api=originalApi(),post=api.postMessage;api.postMessage=m=>{post(m);if(m.type==='rebasePlan')setTimeout(()=>deliver({type:'rebasePlan',request:m.request,plan:{base:m.ref,head:fixture.commits[0].hash,branch:'main',commits:fixture.commits.slice(1).reverse()}}),0)};return api};`;
  const server=http.createServer(async(req,res)=>{
    try {
      const name=new URL(req.url,'http://localhost').pathname;
      if(name==='/') {res.setHeader('content-type','text/html');res.end(html);return;}
      if(name==='/bridge.js'){res.setHeader('content-type','text/javascript');res.end(bridge+rebaseBridge);return;}
      if(name==='/theme.css'){res.setHeader('content-type','text/css');res.end(theme);return;}
      if(!['/workspace.css','/timeline.css','/workspace.js','/graphLayout.js','/i18n.js','/activity.js'].includes(name)){res.writeHead(404);res.end();return;}
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
  const click=async selector=>{await evaluate(`{const node=document.querySelector(${JSON.stringify(selector)});if(typeof node.click==='function')node.click();else node.dispatchEvent(new MouseEvent('click',{bubbles:true}));}`);};
  await call('Runtime.enable');await call('Log.enable');await call('Page.enable');
  await call('Emulation.setDeviceMetricsOverride',{width:1440,height:780,deviceScaleFactor:1,mobile:false});
  await call('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:'dark'}]});
  await call('Page.navigate',{url:'http://127.0.0.1:'+server.address().port+'/'});
  await until("document.querySelectorAll('.commit-row').length===4");
  assert.equal(await evaluate("document.querySelectorAll('.commit-subject img').length"),0);
  assert.equal(await evaluate("document.querySelectorAll('img').length"),0);
  assert.equal(await evaluate("document.querySelectorAll('.commit-subject')[3].textContent"),commits[3].subject);
  // Use a readable sample subject in the screenshots after verifying hostile text.
  await evaluate("fixture.commits[3].subject='Create the initial repository';deliver({type:'data',data:fixture})");
  assert.equal(await evaluate("document.querySelector('[data-tab=graph]>span').textContent"),translate('Commit graph'));
  assert.equal(await evaluate("document.getElementById('search').placeholder"),translate('Search commits, press Enter'));
  await evaluate("fixture.commits[2].subject='中文提交消息保持原文';deliver({type:'data',data:fixture})");
  assert.equal(await evaluate("document.querySelectorAll('.commit-subject')[2].lastElementChild.textContent"),'中文提交消息保持原文');
  await evaluate("fixture.commits[2].subject='Draw topology from commit parents';deliver({type:'data',data:fixture})");
  await until("document.querySelectorAll('.activity-day').length>80");
  assert.equal(await evaluate("document.querySelector('.activity-stats strong').textContent"),'3');
  assert.equal(await evaluate("document.querySelectorAll('.activity-stats strong')[1].textContent"),'2');
  assert.equal(await evaluate("document.querySelector('.activity-identity').textContent"),'gitrism@example.invalid');
  await click('.advanced-search summary');
  await evaluate("document.getElementById('since').value='2026-10-01';document.getElementById('until').value='2026-10-05';document.getElementById('authors').value='Chen; Tester';document.getElementById('merges').value='exclude';document.getElementById('first-parent').checked=true");
  await click('.advanced-panel [data-action=search]');await until("fixture.options.firstParent===true");
  assert.deepEqual(await evaluate("fixture.options.authors"),['Chen','Tester']);
  assert.equal(await evaluate("fixture.options.merges"),'exclude');
  assert.equal(await evaluate("fixture.options.since"),await evaluate("GitrismActivity.dayBounds('2026-10-01').since"));
  await click('[data-action=clearSearch]');await until("fixture.options.query===''");
  await click('.activity-day[data-count="2"]');await until("fixture.options.authorEmail==='gitrism@example.invalid'");
  assert.equal(await evaluate("fixture.options.merges"),'exclude');
  assert.equal(await evaluate("fixture.options.searchBy"),'message');
  assert.ok(await evaluate("fixture.options.since && fixture.options.until"));
  await click('[data-action=clearSearch]');await until("fixture.options.authorEmail===undefined");
  await click('.commit-row');await until("document.querySelector('.detail-header h2')?.textContent==='Merge feature into main'");
  await click('[data-action=clearSelection]');await until("document.querySelector('.activity-grid')!==null");
  await evaluate("{const period=document.getElementById('activity-period');period.value='52';period.dispatchEvent(new Event('change',{bubbles:true}));}");
  assert.ok(await evaluate("document.querySelectorAll('.activity-day').length>350"));
  await evaluate("{const period=document.getElementById('activity-period');period.value='0';period.dispatchEvent(new Event('change',{bubbles:true}));}");
  await click('.commit-row');await until("document.querySelector('.detail-header h2')?.textContent==='Merge feature into main'");

  await click('.file-diff');assert.equal(await evaluate("sent.at(-1).type"),'diff');
  const output=path.join(process.env.GITRISM_SCREENSHOTS || '/tmp/gitrism-preview',locale);await fs.mkdir(output,{recursive:true});
  const screenshot=async name=>{
    await evaluate("new Promise(resolve=>setTimeout(()=>requestAnimationFrame(()=>requestAnimationFrame(resolve)),160))");
    await fs.writeFile(path.join(output,name),Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
  };
  await screenshot('dark.png');
  await click('.more-actions summary');
  assert.ok(await evaluate("document.querySelector('[data-action=compareStart]').getBoundingClientRect().height>0"));
  await click('[data-action=compareStart]');
  assert.equal(await evaluate("document.getElementById('compare-from').value"),hash(1));
  await click('[data-tab="changes"]');
  await screenshot('changes.png');
  await evaluate("const draft=document.getElementById('draft');draft.value='Keep draft after refresh';draft.dispatchEvent(new Event('input',{bubbles:true}))");
  await click('[data-action="refresh"]');await until("document.getElementById('draft')?.value==='Keep draft after refresh'");
  await click('[data-action="stage"]');assert.equal(await evaluate("sent.at(-1).type"),'stage');
  await click('[data-tab="graph"]');await evaluate("document.getElementById('search-by').value='author';document.getElementById('search').value='Chen'");await click('[data-action="search"]');
  await until("sent.some(m=>m.type==='search'&&m.searchBy==='author'&&m.query==='Chen')");
  for(const tab of ['branches','tags','stashes','worktrees','compare']){
    await click('[data-tab="'+tab+'"]');assert.ok(await evaluate("document.querySelector('.content h2')?.textContent"));
    await screenshot(tab+'.png');
  }
  await click('[data-tab="worktrees"]');
  await evaluate("fixture.worktreesError='Cannot read <img src=x onerror=alert(1)> worktrees';deliver({type:'data',data:fixture})");
  assert.equal(await evaluate("document.querySelector('.content strong')?.textContent"),translate('Unable to read worktrees'));
  assert.equal(await evaluate("document.querySelectorAll('img').length"),0);
  assert.equal(await evaluate("document.querySelector('[data-action=createWorktree]')"),null);
  await click('[data-tab="graph"]');assert.equal(await evaluate("document.querySelectorAll('.commit-row').length"),4);
  await evaluate("delete fixture.worktreesError;deliver({type:'data',data:fixture})");await click('[data-tab="worktrees"]');
  assert.equal(await evaluate("document.querySelectorAll('.card').length"),2);await click('[data-tab="compare"]');
  await evaluate("document.getElementById('compare-from').value='main';document.getElementById('compare-to').value='feature/graph'");await click('[data-action="compare"]');await until("document.querySelector('.comparison-summary')!==null");
  await click('[data-tab="timeline"]');await evaluate("document.getElementById('timeline-file').value='src/app.ts'");await click('[data-action="timelineSearch"]');await until("document.querySelectorAll('.timeline-list .timeline-commit').length===3");
  await click('[data-tab="graph"]');assert.equal(await evaluate("document.querySelectorAll('.commit-row').length"),4);
  await click('[data-tab="rebase"]');await evaluate("document.getElementById('rebase-base').value='HEAD~3'");await click('[data-action="rebasePlan"]');await until("document.querySelectorAll('.rebase-step').length===3");
  assert.equal(await evaluate("document.querySelector('[data-action=applyRebase]').disabled"),true);
  await evaluate("fixture.status.files=[];fixture.status.staged=0;fixture.status.changed=0;fixture.status.untracked=0;deliver({type:'data',data:fixture})");
  await click('[data-action="moveRebase"][data-index="2"][data-direction="-1"]');
  await evaluate("const action=document.querySelector('[data-rebase-index=\"1\"]');action.value='fixup';action.dispatchEvent(new Event('change',{bubbles:true}))");await click('[data-action="applyRebase"]');
  assert.equal(await evaluate("sent.at(-1).type"),'applyRebase');assert.equal(await evaluate("sent.at(-1).steps[1].action"),'fixup');
  await screenshot('rebase.png');
  await click('[data-tab="graph"]');
  await click('[data-action="clearSearch"]');await until("fixture.options.query===''");
  await click('.commit-row');await until("document.querySelector('.detail-header h2')?.textContent==='Merge feature into main'");
  await call('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:'light'}]});
  await screenshot('light.png');
  await call('Emulation.setDeviceMetricsOverride',{width:480,height:740,deviceScaleFactor:1,mobile:false});
  assert.ok(await evaluate("document.documentElement.scrollWidth<=480"));
  await screenshot('narrow.png');
  await click('[data-action=clearSelection]');await until("document.querySelector('.activity-svg')?.getAttribute('viewBox')==='0 0 390 128'");await screenshot('activity-narrow.png');
  // All views must fit a small window; cards/forms must not overflow the document.
  await call('Emulation.setDeviceMetricsOverride',{width:320,height:740,deviceScaleFactor:1,mobile:false});
  for(const tab of ['graph','changes','branches','tags','stashes','worktrees','compare','timeline','rebase']) {
    await click('[data-tab="'+tab+'"]');
    assert.ok(await evaluate("document.documentElement.scrollWidth<=320"),tab+' should fit a 320px window');
    assert.ok(await evaluate("document.querySelector('.content').scrollWidth<=document.querySelector('.content').clientWidth"),tab+' content should not overflow horizontally');
  }
  await click('[data-tab="graph"]');await click('[data-action="clearSearch"]');await until("document.querySelector('.activity-svg')?.getAttribute('viewBox')==='0 0 208 128'");
  await call('Emulation.setDeviceMetricsOverride',{width:1440,height:300,deviceScaleFactor:1,mobile:false});
  await call('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:'dark'}]});
  // A long, filtered history exercises wrapping, contained scrolling and selection.
  await evaluate("fixture.commits=Array.from({length:60},(_,i)=>({...fixture.commits[0],hash:i.toString(16).padStart(40,'0'),parents:i<59?[(i+1).toString(16).padStart(40,'0')]:[],refs:i===0?'HEAD -> main':'',subject:'Commit '+i}));fixture.options={query:'test',file:'src/app.ts'};deliver({type:'data',data:fixture})");
  assert.ok(await evaluate("document.querySelector('.graph-scroll').clientHeight>=100"),'Short panel should retain room for the graph: '+await evaluate("JSON.stringify(['.header','.tabs','.filters','.hint','.graph-scroll','.footer'].map(s=>[s,document.querySelector(s)?.clientHeight]))"));
  assert.ok(await evaluate("document.querySelector('.graph-scroll').scrollHeight>document.querySelector('.graph-scroll').clientHeight"),'Long history should scroll inside the graph');
  assert.ok(await evaluate("document.querySelector('.graph-layout').getBoundingClientRect().bottom<=document.querySelector('.footer').getBoundingClientRect().top+1"),'Filters and graph must fit above the footer');
  await evaluate("document.getElementById('graph-scroll').scrollTop=160;deliver({type:'data',data:fixture})");
  assert.equal(await evaluate("document.getElementById('graph-scroll').scrollTop"),160);
  await screenshot('panel.png');
  await click('.advanced-search summary');
  assert.ok(await evaluate("document.querySelector('.advanced-panel').getBoundingClientRect().bottom<=document.querySelector('.footer').getBoundingClientRect().top+1"));
  await evaluate("document.querySelector('.advanced-panel').scrollTop=1000");
  assert.ok(await evaluate("document.querySelector('.advanced-panel [data-action=search]').getBoundingClientRect().bottom<=document.querySelector('.advanced-panel').getBoundingClientRect().bottom"));await screenshot('advanced-panel.png');
  await click('.advanced-search summary');
  await call('Emulation.setDeviceMetricsOverride',{width:1440,height:780,deviceScaleFactor:1,mobile:false});
  await click('[data-action=clearSearch]');await until("fixture.options.query===''");
  await evaluate("fixture.commits=fixture.commits.slice(0,16).map((c,i)=>({...c,subject:['Add personal activity calendar','Improve code attribution links','Support literal author filters','Keep remote dates in client timezone','Refine compact workspace layout','Add retained-line author details','Validate advanced search requests','Handle missing repository identity'][i%8]}));fixture.hasMore=false;deliver({type:'data',data:fixture});document.getElementById('graph-scroll').scrollTop=0;deliver({type:'activity',root:fixture.root,activity:{email:'gitrism@example.invalid',timestamps:Array.from({length:90},(_,i)=>Array.from({length:i%7<5?(i*13)%9:0},()=>Math.floor(Date.now()/1000)-i*86400)).flat()}})");
  await screenshot('activity.png');
  await click('.advanced-search summary');await screenshot('advanced-search.png');
  assert.deepEqual(errors,[],'No script or CSP errors should occur');
});
