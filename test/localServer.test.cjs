const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {execFile,spawn}=require('node:child_process');
const {promisify}=require('node:util');
const run=promisify(execFile);
const {startLocalServer}=require('../out/localServer');
const {GitService}=require('../out/gitService');
const {withGitMutation}=require('../out/mutationLock');
const {setLanguage}=require('../out/localization');
const {browser}=require('./helpers/browser.cjs');
async function repository(t){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'gitrism-local-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const git=(...args)=>run('git',args,{cwd:dir});
  await git('init','-b','main');await git('config','user.name','Local Tester');await git('config','user.email','self@example.invalid');
  await fs.mkdir(path.join(dir,'src'));await fs.writeFile(path.join(dir,'src/a file.ts'),'function hello() {\n  return "<img src=x>";\n}\n');
  await git('add','.');await git('commit','-m','Initial local workspace');
  await fs.writeFile(path.join(dir,'src/a file.ts'),'function hello() {\n  return "<script>changed</script>";\n}\n');
  return {dir,git};
}
async function workspace(t,dir,opts={}){const app=await startLocalServer({repo:dir,...opts});t.after(()=>app.close());return app;}
async function connect(app){
  const controller=new AbortController();
  const response=await fetch(app.origin+'/api/events',{headers:{'X-Gitrism-Token':app.token},signal:controller.signal});
  const reader=response.body.getReader(),messages=[];let pending='',client;
  const loop=(async()=>{try{while(true){const chunk=await reader.read();if(chunk.done)return;pending+=Buffer.from(chunk.value).toString();let split;while((split=pending.indexOf('\n\n'))!==-1){const m=JSON.parse(pending.slice(6,split));pending=pending.slice(split+2);messages.push(m);if(m.type==='connected')client=m.client;}}}catch(e){if(e.name!=='AbortError')throw e;}})();
  for(let i=0;i<100&&!client;i++)await new Promise(r=>setTimeout(r,10));assert.ok(client);
  return {messages,close:async()=>{controller.abort();await loop;},send:async message=>{const r=await fetch(app.origin+'/api/message',{method:'POST',headers:{'X-Gitrism-Token':app.token,Origin:app.origin,'Content-Type':'application/json'},body:JSON.stringify({client,message})});assert.equal(r.status,202);},until:async predicate=>{for(let i=0;i<200;i++){const value=messages.find(predicate);if(value)return value;await new Promise(r=>setTimeout(r,15));}throw new Error('Message not received: '+JSON.stringify(messages));}};
}
test('local server requires its secret, exact host and origin, and serves a strict browser shell',async t=>{
  const {dir}=await repository(t),app=await workspace(t,dir);
  assert.equal((await fetch(app.origin+'/api/events')).status,403);
  assert.equal((await fetch(app.origin+'/api/events',{headers:{'X-Gitrism-Token':app.token,Origin:'https://other.example'}})).status,403);
  const status=await new Promise((resolve,reject)=>{require('node:http').get(app.origin+'/',{headers:{Host:'attacker.example'}},res=>{res.resume();resolve(res.statusCode)}).on('error',reject)});assert.equal(status,403);
  assert.equal((await fetch(app.origin+'/api/message',{method:'POST',headers:{'X-Gitrism-Token':app.token},body:'{}'})).status,404);
  const shell=await fetch(app.origin+'/');assert.match(shell.headers.get('content-security-policy'),/connect-src 'self'/);assert.match(shell.headers.get('content-security-policy'),/frame-ancestors 'none'/);
  const html=await shell.text();assert.ok(!html.includes(app.token));assert.ok(!html.includes(dir));
  assert.equal((await fetch(app.origin+'/gitService.ts')).status,404);
});
test('real browser host reads history, compares content safely, stages and commits, confirms branch deletion', {timeout:45000},async t=>{
  const {dir,git}=await repository(t),events=[],app=await workspace(t,dir,{editor:e=>events.push(e)});
  await git('branch','temporary');
  const b=await browser(t,app.url);if(!b)return;
  await b.until("document.querySelectorAll('.commit-row').length===1");
  assert.equal(await b.evaluate('location.hash'),'');
  await b.click('[data-action=networkSettings]');await b.until("document.querySelector('#network-settings[open]')!==null");
  assert.match(await b.evaluate("document.querySelector('#network-settings').textContent"),/machine running Git/);
  if(process.env.GITRISM_PROXY_PREVIEW){const shot=await b.call('Page.captureScreenshot',{format:'png'});await fs.writeFile(process.env.GITRISM_PROXY_PREVIEW,Buffer.from(shot.data,'base64'));}
  await b.evaluate("{const mode=document.getElementById('network-mode');mode.value='custom';mode.dispatchEvent(new Event('change'));document.getElementById('network-url').value='http://user:secret@localhost:7890';document.getElementById('network-form').requestSubmit();}");
  await b.until("!document.getElementById('network-error').hidden && !document.getElementById('network-save').disabled");
  await b.evaluate("document.getElementById('network-url').value='127.0.0.1:7890';document.getElementById('network-form').requestSubmit();");
  await b.until("document.getElementById('network-settings')===null && document.querySelector('.proxy-active')!==null");
  await b.click('[data-action=networkSettings]');assert.equal(await b.evaluate("document.getElementById('network-url').value"),'http://127.0.0.1:7890');
  await b.call('Emulation.setDeviceMetricsOverride',{width:320,height:500,deviceScaleFactor:1,mobile:false});
  assert.ok(await b.evaluate("{const r=document.getElementById('network-settings').getBoundingClientRect();r.left>=0 && r.right<=320 && r.height<=500}"));
  await b.evaluate("document.getElementById('network-mode').value='inherit';document.getElementById('network-form').requestSubmit();");
  await b.until("document.getElementById('network-settings')===null && document.querySelector('.proxy-active')===null");
  await b.call('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});

  await b.click('[data-tab=changes]');await b.until("document.querySelector('[data-action=workingDiff]')!==null");
  await b.click('[data-action=workingDiff]');await b.until("document.querySelector('.browser-diff[open]')!==null");
  assert.ok((await b.evaluate("document.querySelector('.browser-diff').textContent")).includes('<script>changed</script>'));
  assert.equal(await b.evaluate("document.querySelectorAll('.browser-diff script,.browser-diff img').length"),0);
  await b.click('.browser-diff-header button');for(let i=0;i<100&&!events.length;i++)await new Promise(r=>setTimeout(r,10));assert.equal(events.at(-1).type,'openFile');assert.equal(events.at(-1).path,path.join(dir,'src/a file.ts'));
  await b.evaluate("document.querySelector('.browser-diff').close()");
  await b.click('[data-action=stage]');await b.until("document.querySelector('[data-action=unstage]')!==null");
  await b.evaluate("{const d=document.getElementById('draft');d.value='Commit from local browser';d.dispatchEvent(new Event('input',{bubbles:true}));}");
  await b.click('[data-action=commit]');await b.until("document.querySelectorAll('.working-file').length===0 && document.getElementById('draft').value===''");
  assert.equal((await git('log','-1','--format=%s')).stdout.trim(),'Commit from local browser');
  await b.click('[data-tab=branches]');await b.until("document.querySelector('[data-action=deleteBranch]')!==null");await b.click('[data-action=deleteBranch]');
  await b.until("document.querySelector('.browser-dialog[open]')!==null");await b.click('.browser-dialog button[value=cancel]');
  assert.match((await git('branch')).stdout,/temporary/);
  await b.until("!document.querySelector('[data-action=deleteBranch]').disabled");await b.click('[data-action=deleteBranch]');await b.until("document.querySelector('.browser-dialog[open]')!==null");await b.click('.browser-dialog button[value=execute]');
  await b.until("document.querySelector('[data-action=deleteBranch]')===null");assert.doesNotMatch((await git('branch')).stdout,/temporary/);
  assert.deepEqual(b.errors,[]);
});
test('independent browser sessions retain filters, reject malformed requests, and protect escaping symlinks',async t=>{
  const {dir}=await repository(t),app=await workspace(t,dir),a=await connect(app),b=await connect(app);t.after(()=>a.close());t.after(()=>b.close());
  await a.send({type:'search',searchBy:'message',query:'no-such-commit'});await b.send({type:'ready'});
  assert.equal((await a.until(m=>m.type==='data')).data.commits.length,0);assert.equal((await b.until(m=>m.type==='data')).data.commits.length,1);
  await a.send({type:'search',searchBy:'message',authors:'wrong'});await a.until(m=>m.type==='error');
  const outside=await fs.mkdtemp(path.join(os.tmpdir(),'gitrism-outside-'));t.after(()=>fs.rm(outside,{recursive:true,force:true}));
  await fs.writeFile(path.join(outside,'secret'),'not readable');await fs.symlink(path.join(outside,'secret'),path.join(dir,'link'));
  await b.send({type:'workingDiff',file:'link'});await b.until(m=>m.type==='error'&&m.message.includes('outside'));
});
test('mutation lock spans worktrees and processes and is released after failures',async t=>{
  const {dir,git}=await repository(t),service=new GitService(dir);
  const second=path.join(dir,'../'+path.basename(dir)+'-worktree');t.after(()=>fs.rm(second,{recursive:true,force:true}));
  await git('worktree','add','-b','linked',second);
  let release;const hold=withGitMutation(service,()=>new Promise(r=>{release=r;}));
  for(let i=0;i<100&&!release;i++)await new Promise(r=>setTimeout(r,10));assert.ok(release);
  await assert.rejects(withGitMutation(new GitService(second),async()=>{}),/holds/);
  const script='require('+JSON.stringify(path.resolve('out/mutationLock'))+').withGitMutation(new (require('+JSON.stringify(path.resolve('out/gitService'))+').GitService)(process.argv[1]),async()=>{}).catch(e=>{console.error(e.message);process.exitCode=1})';
  await assert.rejects(run(process.execPath,['-e',script,dir]),e=>e.stderr.includes('holds'));
  release();await hold;
  await assert.rejects(withGitMutation(service,async()=>{throw new Error('failed')}),/failed/);
  await withGitMutation(service,async()=>{});
});
test('CLI editor bridge queries attribution, rejects invalid ranges and paths, and exits on stdin EOF', {timeout:15000},async t=>{
  const {dir}=await repository(t),child=spawn(process.execPath,['bin/gitrism.cjs','serve','--repo',dir,'--stdio'],{cwd:path.resolve('.'),stdio:['pipe','pipe','pipe']});
  t.after(()=>{if(child.exitCode===null)child.kill();});
  let output='',stderr='';const messages=[];
  child.stderr.on('data',c=>{stderr+=c});child.stdout.on('data',c=>{output+=c;let i;while((i=output.indexOf('\n'))!==-1){messages.push(JSON.parse(output.slice(0,i)));output=output.slice(i+1)}});
  const until=async predicate=>{for(let i=0;i<200;i++){const m=messages.find(predicate);if(m)return m;await new Promise(r=>setTimeout(r,10));}throw new Error('No CLI response '+stderr);};
  const ready=await until(m=>m.type==='ready');assert.match(ready.url,/^http:\/\/127\.0\.0\.1:\d+\/#token=/);
  for(const request of [{id:1,method:'attribution',file:'src/a file.ts',start:1,end:3},{id:2,method:'blame',file:'src/a file.ts',start:0,end:1},{id:3,method:'blame',file:'../escape',start:1,end:1}])child.stdin.write(JSON.stringify(request)+'\n');
  const authors=await until(m=>m.id===1);assert.ok(authors.result.authors.length===1);assert.ok(authors.result.uncommitted>0);
  assert.match((await until(m=>m.id===2)).error,/Invalid line range/);assert.ok((await until(m=>m.id===3)).error);
  child.stdin.end();await new Promise(r=>child.once('exit',r));assert.equal(child.exitCode,0,stderr);
  await assert.rejects(fetch(ready.url));
});

test('browser proxy settings validate requests, synchronize clients, and reset with the service',async t=>{
  const {dir}=await repository(t),app=await workspace(t,dir),a=await connect(app),b=await connect(app);t.after(()=>a.close());t.after(()=>b.close());
  await a.send({type:'saveNetworkProxy',request:81,config:{mode:'custom',url:'http://user:secret@localhost:7890'}});
  await a.until(m=>m.type==='error'&&m.request===81);
  await a.send({type:'saveNetworkProxy',request:82,config:{mode:'custom',url:'192.168.1.2:7890'}});
  const saved=await a.until(m=>m.type==='networkProxySaved'&&m.request===82);assert.equal(saved.config.url,'http://192.168.1.2:7890');
  const update=await b.until(m=>m.type==='data'&&m.data.network.config.mode==='custom');assert.equal(update.data.network.scope,'session');assert.equal(update.data.network.config.url,saved.config.url);
  const second=await workspace(t,dir),c=await connect(second);t.after(()=>c.close());await c.send({type:'ready'});
  assert.equal((await c.until(m=>m.type==='data')).data.network.config.mode,'inherit');
});
