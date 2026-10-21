const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const run=promisify(execFile);
test('Native Neovim graph, merge lanes, paging, filters, patches, attribution and optional browser',{timeout:60000},async t=>{
  const nvim=process.env.GITRISM_NVIM||'nvim';
  try{await run(nvim,['--version']);}catch{t.skip('Set GITRISM_NVIM to Neovim 0.10+');return;}
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'gitrism-nvim space-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const git=(...args)=>run('git',args,{cwd:root});
  await git('init','-b','main');await git('config','user.name','Local Tester');await git('config','user.email','local@example.invalid');
  const file=path.join(root,'hello world.lua');await fs.writeFile(file,'function hello()\n  return "hello"\nend\n');
  await git('add','.');await git('commit','-m','Initial local workspace');
  await fs.writeFile(file,'function hello()\n  return \"hello there\"\nend\n');await git('-c','user.name=Line Reviewer','-c','user.email=reviewer@example.invalid','commit','-am','Refine the greeting');
  for(let i=0;i<3;i++){await fs.writeFile(path.join(root,'notes.txt'),`Main note ${i}\n`);await git('add','.');await git('commit','-m',`Write note ${i}`);}
  await git('checkout','-b','feature');await fs.writeFile(path.join(root,'feature.txt'),'feature\n');await git('add','.');await git('commit','-m','Add feature');
  await git('checkout','main');await fs.writeFile(path.join(root,'main.txt'),'main\n');await git('add','.');await git('commit','-m','Change main');
  await git('merge','--no-ff','feature','-m','Merge feature');
  const renamed=path.join(root,'renamed world.lua');await git('mv',file,renamed);await git('commit','-m','Rename Lua module');
  const empty=path.join(root,'empty');await fs.mkdir(empty);await run('git',['init',empty]);
  const result=await run(nvim,['--headless','-u','NONE','-l',path.resolve('test/helpers/neovim.lua')],{cwd:root,timeout:55000,env:{...process.env,GITRISM_PLUGIN_DIR:path.resolve('editors/neovim'),GITRISM_TEST_FILE:renamed,GITRISM_EMPTY_REPO:empty}});
  assert.match(result.stdout+result.stderr,/GITRISM_NEOVIM_OK/);
});
