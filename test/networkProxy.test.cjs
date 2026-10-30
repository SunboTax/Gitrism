const {test}=require('node:test');
const assert=require('node:assert/strict');
const net=require('node:net');
const http=require('node:http');
const https=require('node:https');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {spawn,execFile}=require('node:child_process');
const {promisify}=require('node:util');
const run=promisify(execFile);
const {GitService}=require('../out/gitService');
const {normalizeNetworkProxy,sshProxyCommand}=require('../out/networkProxy');
const {connectSshProxy}=require('../out/sshProxy');
const {withGitAuthentication}=require('../out/gitAuthentication');

async function listen(t,server){
  const sockets=new Set();server.on('connection',s=>{sockets.add(s);s.on('close',()=>sockets.delete(s));});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  t.after(async()=>{for(const s of sockets)s.destroy();await new Promise(r=>server.close(r));});
  return server.address().port;
}
async function proxies(t){
  const connections=[];
  const tunnel=(host,port,down,ready,head)=>{
    // All test destinations must stay on loopback.
    assert.equal(host,'127.0.0.1');
    const up=net.connect(port,host);up.on('error',()=>down.destroy());down.on('error',()=>up.destroy());down.on('close',()=>up.destroy());up.on('close',()=>down.destroy());
    up.once('connect',()=>{down.write(ready);if(head?.length)up.write(head);down.pipe(up).pipe(down);});
  };
  const httpProxy=http.createServer((req,res)=>{res.writeHead(500);res.end();});
  httpProxy.on('connect',(req,down,head)=>{connections.push('http');const [host,port]=req.url.split(':');tunnel(host,Number(port),down,'HTTP/1.1 200 Connection established\r\n\r\n',head);});
  const httpPort=await listen(t,httpProxy);
  const socks=net.createServer(down=>{
    let buffer=Buffer.alloc(0),greeted=false;
    const receive=data=>{
      buffer=Buffer.concat([buffer,data]);
      if(!greeted){if(buffer.length<3)return;assert.equal(buffer[0],5);const length=2+buffer[1];if(buffer.length<length)return;buffer=buffer.subarray(length);greeted=true;down.write(Buffer.from([5,0]));}
      if(buffer.length<5)return;
      let host,end;
      if(buffer[3]===1){if(buffer.length<10)return;host=[...buffer.subarray(4,8)].join('.');end=8;}
      else {assert.equal(buffer[3],3);end=5+buffer[4];if(buffer.length<end+2)return;host=buffer.subarray(5,end).toString();}
      if(buffer.length<end+2)return;
      const port=buffer.readUInt16BE(end);connections.push('socks');down.off('data',receive);
      tunnel(host,port,down,Buffer.from([5,0,0,1,127,0,0,1,0,0]),buffer.subarray(end+2));
    };
    down.on('error',()=>{});down.on('data',receive);
  });
  const socksPort=await listen(t,socks);
  return {connections,http:`http://127.0.0.1:${httpPort}`,socks:`socks5h://127.0.0.1:${socksPort}`};
}

test('proxy endpoints normalize protocols and reject credentials, injection and malformed settings',()=>{
  assert.deepEqual(normalizeNetworkProxy({mode:'custom',url:'127.0.0.1:7890'}),{mode:'custom',url:'http://127.0.0.1:7890'});
  for(const url of ['http://host:80','socks5h://192.168.1.2:1080','socks5://host:1080','http://[::1]:7890'])assert.equal(normalizeNetworkProxy({mode:'custom',url}).url,url);
  for(const url of ['','http://host:0','http://host:65536','socks5://host','https://host:7890','http://user:token@host:7890','http://host:7890/path','http://host:7890?token=x','host:123\ncommand',"host:123'",'http://host:7890/#secret'])assert.throws(()=>normalizeNetworkProxy({mode:'custom',url}));
  for(const mode of [['custom'],{},null,'invalid'])assert.throws(()=>normalizeNetworkProxy({mode,url:''}));
  const command=sshProxyCommand('ssh -i /key -o ProxyCommand=old',true);
  assert.ok(command.indexOf('sshProxy.js')<command.indexOf('ProxyCommand=old'));assert.match(command,/-i \/key/);
});

test('real HTTPS fetch, pull and push use HTTP/SOCKS proxies, override Git proxy settings, and support direct mode',{timeout:30000},async t=>{
  const oldNoProxy={NO_PROXY:process.env.NO_PROXY,no_proxy:process.env.no_proxy};
  process.env.NO_PROXY=process.env.no_proxy='127.0.0.1';
  t.after(()=>{for(const [key,value] of Object.entries(oldNoProxy)){if(value===undefined)delete process.env[key];else process.env[key]=value;}});
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'gitrism-proxy-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const env={...process.env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:os.devNull,GIT_TERMINAL_PROMPT:'0'};
  const git=async(cwd,...args)=>(await run('git',args,{cwd,env})).stdout.trim();
  const local=path.join(root,'local'),bare=path.join(root,'remote.git');await fs.mkdir(local);
  await git(root,'init','--bare',bare);await git(local,'init','-b','main');await git(local,'config','user.name','Proxy Test');await git(local,'config','user.email','test@example.invalid');
  await fs.writeFile(path.join(local,'file'),'first\n');await git(local,'add','.');await git(local,'commit','-m','Initial');await git(local,'remote','add','origin',bare);await git(local,'push','-u','origin','main');await git(bare,'config','http.receivepack','true');
  await git(local,'config','credential.helper','');
  await run('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=127.0.0.1','-addext','subjectAltName=IP:127.0.0.1','-keyout',path.join(root,'key.pem'),'-out',path.join(root,'cert.pem')]);
  const origin=https.createServer({key:await fs.readFile(path.join(root,'key.pem')),cert:await fs.readFile(path.join(root,'cert.pem'))},(req,res)=>{
    if(req.headers.authorization!=='Basic '+Buffer.from('test:fixture-token').toString('base64')){res.writeHead(401,{'WWW-Authenticate':'Basic realm="Proxy fixture"'}).end();return;}
    const url=new URL(req.url,'https://127.0.0.1');
    const child=spawn('git',['http-backend'],{env:{...env,GIT_PROJECT_ROOT:root,GIT_HTTP_EXPORT_ALL:'1',PATH_INFO:url.pathname,QUERY_STRING:url.search.slice(1),REQUEST_METHOD:req.method,CONTENT_TYPE:req.headers['content-type']||'',CONTENT_LENGTH:req.headers['content-length']||'',HTTP_GIT_PROTOCOL:req.headers['git-protocol']||'',REMOTE_USER:'test'},stdio:['pipe','pipe','pipe']});
    req.pipe(child.stdin);child.stdin.on('error',()=>{});child.stderr.resume();let header=Buffer.alloc(0),sent=false;
    child.stdout.on('data',chunk=>{if(sent){res.write(chunk);return;}header=Buffer.concat([header,chunk]);const index=header.indexOf('\r\n\r\n');if(index<0)return;const lines=header.subarray(0,index).toString().split('\r\n');const headers={};let status=200;for(const line of lines){const colon=line.indexOf(':');const key=line.slice(0,colon);const value=line.slice(colon+1).trim();if(key.toLowerCase()==='status')status=Number(value.split(' ')[0]);else headers[key]=value;}res.writeHead(status,headers);sent=true;res.write(header.subarray(index+4));});
    child.on('close',()=>res.end());child.on('error',e=>res.destroy(e));
  });
  const port=await listen(t,origin),proxy=await proxies(t);
  await git(local,'remote','set-url','origin',`https://127.0.0.1:${port}/remote.git`);
  await git(local,'config','http.sslCAInfo',path.join(root,'cert.pem'));
  await git(local,'config','remote.origin.proxy','http://127.0.0.1:1');
  await git(local,'config',`http.https://127.0.0.1:${port}/.proxy`,'http://127.0.0.1:1');
  const configBefore=await git(local,'config','--local','--list');
  let prompts=0;
  const service=new GitService(local,undefined,{mode:'custom',url:proxy.http},operation=>withGitAuthentication(async prompt=>{prompts++;return prompt.startsWith('Username')?'test':'fixture-token';},operation));
  for(const [scheme,url] of [['http',proxy.http],['socks',proxy.socks]]){
    service.setNetworkProxy({mode:'custom',url});await service.fetch();await service.pull();
    await fs.appendFile(path.join(local,'file'),scheme+'\n');await git(local,'commit','-am','Push via '+scheme);await service.push();
    assert.equal(await git(bare,'rev-parse','main'),await git(local,'rev-parse','HEAD'));assert.ok(proxy.connections.filter(x=>x===scheme).length>=3);
  }
  const before=proxy.connections.length;service.setNetworkProxy({mode:'direct',url:''});await service.fetch();assert.equal(proxy.connections.length,before);
  process.env.NO_PROXY=process.env.no_proxy='';
  service.setNetworkProxy({mode:'inherit',url:''});await assert.rejects(service.fetch(),/Git operation failed/);
  service.setNetworkProxy({mode:'custom',url:'http://127.0.0.1:1'});assert.equal((await service.status()).branch,'main');
  assert.equal(await git(local,'config','--local','--list'),configBefore);
  assert.ok(prompts>0,'TLS and both proxy transports must also support credential prompts');
});

test('SSH tunnels preserve immediate banners and data with HTTP and SOCKS5; helper works over stdio',{timeout:10000},async t=>{
  const target=net.createServer(s=>{s.write('SSH-2.0-fixture\r\n');s.on('data',data=>s.write(data));});
  const port=await listen(t,target),proxy=await proxies(t);
  for(const url of [proxy.http,proxy.socks]){
    const socket=await connectSshProxy(url,'127.0.0.1',port);t.after(()=>socket.destroy());
    let received='';socket.on('data',chunk=>{received+=chunk});socket.write('echo-payload');
    for(let i=0;i<100&&!received.includes('echo-payload');i++)await new Promise(r=>setTimeout(r,10));
    assert.equal(received,'SSH-2.0-fixture\r\necho-payload');socket.destroy();
  }
  const child=spawn(process.execPath,['out/sshProxy.js','127.0.0.1',String(port)],{env:{...process.env,GITRISM_PROXY_URL:proxy.http},stdio:['pipe','pipe','pipe']});
  t.after(()=>child.kill());let output='';child.stdout.on('data',b=>{output+=b});child.stdin.write('through-stdio');
  for(let i=0;i<200&&!output.includes('through-stdio');i++)await new Promise(r=>setTimeout(r,10));
  assert.equal(output,'SSH-2.0-fixture\r\nthrough-stdio');child.stdin.end();await new Promise(r=>child.once('exit',r));
  const rejected=http.createServer();rejected.on('connect',(_req,s)=>s.end('HTTP/1.1 407 Secret-proxy-response\r\n\r\n'));
  const refused=await listen(t,rejected);
  await assert.rejects(connectSshProxy(`http://127.0.0.1:${refused}`,'127.0.0.1',port),/refused/);
});

test('real OpenSSH Git operations keep key authentication while using the configured HTTP/SOCKS tunnel',{timeout:20000},async t=>{
  try {await fs.access('/usr/sbin/sshd');await run('ssh-keygen',['-V']);} catch(e){if(e.code==='ENOENT'){t.skip('OpenSSH server unavailable');return;}}
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'gitrism-proxy-ssh-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const env={...process.env,GIT_CONFIG_GLOBAL:os.devNull,GIT_CONFIG_NOSYSTEM:'1'};
  const git=async(cwd,...args)=>(await run('git',args,{cwd,env})).stdout.trim();
  for(const key of ['host','client'])await run('ssh-keygen',['-q','-t','ed25519','-N','','-f',path.join(root,key)]);
  const reserve=net.createServer(),port=await listen(t,reserve);await new Promise(r=>reserve.close(r));
  const hostKey=(await fs.readFile(path.join(root,'host.pub'),'utf8')).split(' ');
  await fs.writeFile(path.join(root,'known_hosts'),`[127.0.0.1]:${port} ${hostKey[0]} ${hostKey[1]}\n`);
  await fs.writeFile(path.join(root,'sshd_config'),`Port ${port}\nListenAddress 127.0.0.1\nHostKey ${root}/host\nAuthorizedKeysFile ${root}/client.pub\nPidFile ${root}/pid\nUsePAM no\nPasswordAuthentication no\nKbdInteractiveAuthentication no\nStrictModes no\nAllowUsers ${os.userInfo().username}\n`);
  const daemon=spawn('/usr/sbin/sshd',['-D','-e','-f',path.join(root,'sshd_config')],{stdio:['ignore','ignore','pipe']});let log='';daemon.stderr.on('data',b=>{log+=b});t.after(()=>{if(daemon.exitCode===null)daemon.kill();});
  for(let i=0;i<100&&!log.includes('Server listening');i++){if(daemon.exitCode!==null)throw new Error(log);await new Promise(r=>setTimeout(r,10));}
  assert.match(log,/Server listening/);
  const local=path.join(root,'local'),bare=path.join(root,'remote.git');await fs.mkdir(local);await git(root,'init','--bare',bare);await git(local,'init','-b','main');await git(local,'config','user.name','SSH Proxy Test');await git(local,'config','user.email','test@example.invalid');await fs.writeFile(path.join(local,'file'),'content');await git(local,'add','.');await git(local,'commit','-m','SSH proxy fixture');await git(local,'remote','add','origin',bare);await git(local,'push','-u','origin','main');
  await git(local,'remote','set-url','origin',`ssh://${os.userInfo().username}@127.0.0.1:${port}${bare}`);
  await git(local,'config','core.sshCommand',`ssh -F ${os.devNull} -i ${root}/client -o UserKnownHostsFile=${root}/known_hosts -o StrictHostKeyChecking=yes -o IdentitiesOnly=yes -o ProxyCommand=false`);
  const proxy=await proxies(t),service=new GitService(local);
  for(const [scheme,url] of [['http',proxy.http],['socks',proxy.socks]]){
    service.setNetworkProxy({mode:'custom',url});await service.fetch();await fs.appendFile(path.join(local,'file'),scheme);await git(local,'commit','-am',scheme);await service.push();assert.equal(await git(bare,'rev-parse','main'),await git(local,'rev-parse','HEAD'));assert.ok(proxy.connections.includes(scheme));
  }
  service.setNetworkProxy({mode:'direct',url:''});const before=proxy.connections.length;await service.fetch();assert.equal(proxy.connections.length,before);
});
