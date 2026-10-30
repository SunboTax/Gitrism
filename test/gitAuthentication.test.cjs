const {test}=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const vm=require('node:vm');
const {execFile,spawn}=require('node:child_process');
const run=require('node:util').promisify(execFile);
const {GitService}=require('../out/gitService');
const {withGitAuthentication}=require('../out/gitAuthentication');

async function environment(t,values){
  const previous=Object.fromEntries(Object.keys(values).map(key=>[key,process.env[key]]));
  Object.assign(process.env,values);
  t.after(()=>{for(const [key,value]of Object.entries(previous))if(value===undefined)delete process.env[key];else process.env[key]=value;});
}
async function ask(env,prompt){
  return (await run(process.execPath,[require.resolve('../out/gitAskpass'),prompt],{env:{...process.env,...env}})).stdout.trim();
}

test('operation-scoped AskPass authenticates requests, handles cancellation, and closes its channel',async()=>{
  let env,signal;
  await withGitAuthentication(async(prompt,abort)=>{signal=abort;assert.match(prompt,/Username/);return 'example-user';},async values=>{
    env=values;
    const address=`http://127.0.0.1:${values.GITRISM_ASKPASS_PORT}/askpass`;
    assert.equal((await fetch(address,{method:'POST',body:'{}'})).status,403);
    assert.equal((await fetch(address,{method:'POST',headers:{Authorization:'Bearer '+values.GITRISM_ASKPASS_TOKEN,Origin:'https://untrusted.invalid'},body:'{}'})).status,403);
    assert.equal(await ask(values,"Username for 'https://example.invalid': "),'example-user');
  });
  assert.equal(signal.aborted,true);
  await assert.rejects(fetch(`http://127.0.0.1:${env.GITRISM_ASKPASS_PORT}/askpass`));
  await withGitAuthentication(async()=>undefined,async values=>{
    await assert.rejects(ask(values,"Password for 'https://example.invalid': "),error=>{
      assert.match(error.stderr,/cancelled or unavailable/);return true;
    });
  });
  let errorEnv;
  await assert.rejects(withGitAuthentication(async()=>'',async values=>{errorEnv=values;throw new Error('operation failed');}),/operation failed/);
  await assert.rejects(fetch(`http://127.0.0.1:${errorEnv.GITRISM_ASKPASS_PORT}/askpass`));
});

test('real Git push/fetch/pull honor inherited AskPass, helpers, and editor authentication without changing Git config',{timeout:30000},async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),"gitrism auth 'quoted' "));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  await environment(t,{GIT_CONFIG_GLOBAL:os.devNull,GIT_CONFIG_NOSYSTEM:'1',GCM_INTERACTIVE:'Auto',NO_PROXY:'127.0.0.1',no_proxy:'127.0.0.1'});
  const git=async(cwd,...args)=>(await run('git',args,{cwd})).stdout.trim();
  const local=path.join(root,'local'),bare=path.join(root,'remote.git');await fs.mkdir(local);
  await git(root,'init','--bare',bare);await git(local,'init','-b','main');
  await git(local,'config','user.name','Auth Test');await git(local,'config','user.email','auth@example.invalid');
  await fs.writeFile(path.join(local,'file'),'initial\n');await git(local,'add','.');await git(local,'commit','-m','Initial');
  await git(local,'remote','add','origin',bare);await git(local,'push','-u','origin','main');await git(bare,'config','http.receivepack','true');
  const password='local-fixture-token',expected='Basic '+Buffer.from('example-user:'+password).toString('base64');
  let authenticated=0;
  const server=http.createServer((req,res)=>{
    if(req.headers.authorization!==expected){res.writeHead(401,{'WWW-Authenticate':'Basic realm="Git fixture"'}).end();return;}
    authenticated++;
    const url=new URL(req.url,'http://127.0.0.1');
    const child=spawn('git',['http-backend'],{env:{...process.env,GIT_PROJECT_ROOT:root,GIT_HTTP_EXPORT_ALL:'1',PATH_INFO:url.pathname,QUERY_STRING:url.search.slice(1),REQUEST_METHOD:req.method,CONTENT_TYPE:req.headers['content-type']||'',CONTENT_LENGTH:req.headers['content-length']||'',HTTP_GIT_PROTOCOL:req.headers['git-protocol']||'',REMOTE_USER:'example-user'}});
    req.pipe(child.stdin);child.stdin.on('error',()=>{});child.stderr.resume();let header=Buffer.alloc(0),sent=false;
    child.stdout.on('data',chunk=>{
      if(sent){res.write(chunk);return;}
      header=Buffer.concat([header,chunk]);const index=header.indexOf('\r\n\r\n');if(index<0)return;
      const headers={};let status=200;
      for(const line of header.subarray(0,index).toString().split('\r\n')){const colon=line.indexOf(':');if(line.slice(0,colon).toLowerCase()==='status')status=Number(line.slice(colon+1).trim().split(' ')[0]);else headers[line.slice(0,colon)]=line.slice(colon+1).trim();}
      res.writeHead(status,headers);sent=true;res.write(header.subarray(index+4));
    });
    child.on('close',()=>res.end());child.on('error',error=>res.destroy(error));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
  await git(local,'remote','set-url','origin',`http://127.0.0.1:${server.address().port}/remote.git`);
  await git(local,'config','credential.helper','');
  const helper=path.join(root,'inherited askpass.cjs');
  await fs.writeFile(helper,`process.stdout.write((process.argv.slice(2).join(' ').startsWith('Username')?'example-user':${JSON.stringify(password)})+${JSON.stringify('\n')});`);
  const quote=value=>"'"+value.replace(/'/g,"'\\''")+"'";
  const wrapper=path.join(root,'inherited askpass.sh');
  await fs.writeFile(wrapper,`#!/bin/sh\nexec ${quote(process.execPath)} ${quote(helper)} "$@"\n`,{mode:0o700});
  await environment(t,{GIT_ASKPASS:wrapper});
  const before=await git(local,'config','--local','--list');
  const inherited=new GitService(local,undefined,{mode:'direct',url:''});
  await fs.appendFile(path.join(local,'file'),'inherited\n');await git(local,'commit','-am','Inherited AskPass');await inherited.push();
  assert.equal(await git(bare,'rev-parse','main'),await git(local,'rev-parse','HEAD'));
  const prompts=[];
  const editor=new GitService(local,undefined,{mode:'direct',url:''},operation=>withGitAuthentication(async prompt=>{prompts.push(prompt);return prompt.startsWith('Username')?'example-user':password;},operation));
  // A stale VS Code socket/helper must not replace the operation's editor channel.
  await environment(t,{GIT_ASKPASS:'/nonexistent/stale-askpass',VSCODE_GIT_IPC_HANDLE:'/nonexistent/stale.sock'});
  await editor.fetch();await editor.pull();
  await fs.appendFile(path.join(local,'file'),'editor\n');await git(local,'commit','-am','Editor AskPass');await editor.push();
  assert.equal(await git(bare,'rev-parse','main'),await git(local,'rev-parse','HEAD'));
  assert.ok(prompts.some(prompt=>prompt.startsWith('Username')));assert.ok(prompts.some(prompt=>prompt.startsWith('Password')));
  assert.ok(authenticated>=5);assert.equal(await git(local,'config','--local','--list'),before);
  const credentialHelper=path.join(root,'credential helper.cjs');
  await fs.writeFile(credentialHelper,`if(process.argv.at(-1)==='get'&&process.env.GCM_INTERACTIVE==='Auto'){process.stdout.write(${JSON.stringify('username=example-user\npassword='+password+'\n')});}process.stdin.resume();`);
  await git(local,'config','credential.helper','!'+quote(process.execPath)+' '+quote(credentialHelper));
  let asked=0;
  const cached=new GitService(local,undefined,{mode:'direct',url:''},operation=>withGitAuthentication(async()=>{asked++;return undefined;},operation));
  await cached.fetch();assert.equal(asked,0,'Configured helper must answer before editor prompts');
  await fs.appendFile(path.join(local,'file'),'credential helper\n');await git(local,'commit','-am','Credential helper');await inherited.push();
  assert.equal(await git(bare,'rev-parse','main'),await git(local,'rev-parse','HEAD'));
  await git(local,'config','credential.helper','');
  await assert.rejects(cached.push(),error=>{assert.doesNotMatch(error.detail||'',new RegExp(password));return true;});
  assert.ok(asked>0);
});

test('editor credentials use GitHub public authentication only for exact HTTPS GitHub prompts',async()=>{
  const prompts=[],signins=[];let ask;
  const session={accessToken:'test-session-token'};
  const api={workspace:{isTrusted:true},authentication:{getSession:async(...args)=>{signins.push(args);return session;}},
    CancellationTokenSource:class{token={};cancel(){}dispose(){}},
    window:{showInputBox:async options=>{prompts.push(options);return 'manual-credential';}}};
  const context={exports:{},URL,require:name=>{
    if(name==='vscode')return api;
    if(name==='./localization')return{t:s=>s};
    if(name==='./gitAuthentication')return{withGitAuthentication:async(prompt,operation)=>{ask=prompt;return operation({});}};
    throw Error(name);
  }};
  vm.runInNewContext(await fs.readFile(require.resolve('../out/editorAuthentication'),'utf8'),context);
  await context.exports.editorGitAuthentication(async()=>{
    const signal=new AbortController().signal;
    assert.equal(await ask("Username for 'https://github.com': ",signal),'x-access-token');
    assert.equal(await ask("Password for 'https://x-access-token@github.com': ",signal),session.accessToken);
    assert.equal(signins.length,1);assert.equal(signins[0][0],'github');
    for(const url of ['https://github.com.attacker.invalid','http://github.com','https://github.com:444','https://example.invalid'])await ask(`Password for '${url}': `,signal);
    assert.equal(signins.length,1);assert.ok(prompts.every(prompt=>prompt.password));
    await ask("Username for 'https://example.invalid': ",signal);assert.equal(prompts.at(-1).password,false);
    const aborted=new AbortController();aborted.abort();assert.equal(await ask("Password for 'https://github.com': ",aborted.signal),undefined);
    api.workspace.isTrusted=false;assert.equal(await ask("Password for 'https://github.com': ",signal),undefined);
  });
});
