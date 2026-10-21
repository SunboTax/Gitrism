const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {spawn}=require('node:child_process');
exports.browser=async function(t,url,width=1440,height=900){
  const chromePath=process.env.GITRISM_CHROME||'/usr/bin/google-chrome';
  try{await fs.access(chromePath);}catch{t.skip('Chrome unavailable');return;}
  const profile=await fs.mkdtemp(path.join(os.tmpdir(),'gitrism-host-browser-'));
  const chrome=spawn(chromePath,['--headless','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{stdio:['ignore','ignore','pipe']});
  t.after(async()=>{chrome.kill();if(chrome.exitCode===null)await new Promise(r=>chrome.once('exit',r));await fs.rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:100});});
  const endpoint=await new Promise((resolve,reject)=>{
    let output='';const timer=setTimeout(()=>reject(new Error('Chrome timeout')),15000);
    chrome.stderr.on('data',c=>{output+=c;const m=output.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(m){clearTimeout(timer);resolve(m[1]);}});
    chrome.once('error',e=>{clearTimeout(timer);reject(e);});
  });
  const targets=await(await fetch('http://'+new URL(endpoint).host+'/json/list')).json();
  const ws=new WebSocket(targets.find(p=>p.type==='page').webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
  t.after(()=>ws.close());
  let serial=0;const pending=new Map(),errors=[];
  ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(m.error):p.resolve(m.result);}if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails);if(m.method==='Log.entryAdded'&&m.params.entry.level==='error')errors.push(m.params.entry);});
  const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++serial;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});
  const evaluate=async expression=>{const result=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw new Error(JSON.stringify(result.exceptionDetails));return result.result.value;};
  const until=async expression=>{for(let i=0;i<200;i++){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,25));}throw new Error('Condition failed: '+expression);};
  await call('Runtime.enable');await call('Log.enable');await call('Page.enable');
  await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
  await call('Page.navigate',{url});
  return {call,evaluate,until,errors,click:selector=>evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`)};
};
