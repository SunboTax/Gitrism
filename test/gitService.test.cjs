const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { GitService, GitError } = require('../out/gitService');
const { layoutGraph } = require('../resources/graphLayout');

async function fixture(t, author = 'Gitrism Tester') {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gitrism-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const run = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_NOSYSTEM:'1' } }).trim();
  run('init', '-q'); run('symbolic-ref', 'HEAD', 'refs/heads/main'); run('config', 'user.name', author); run('config', 'user.email', 'gitrism@example.invalid');
  run('config','commit.gpgsign','false'); run('config','tag.gpgsign','false');
  const write = (file, content) => fs.writeFile(path.join(root,file),content);
  const service = new GitService(root);
  return {root,run,write,service};
}
async function initial(f) { await f.write('base.txt','base\n'); await f.service.stageAll(); await f.service.commit('Initial commit'); return f.run('rev-parse','HEAD'); }

test('unborn repository, dotted branch, file names and first commit diff', async t => {
  const f=await fixture(t); f.run('symbolic-ref','HEAD','refs/heads/feature.with.dots');
  assert.deepEqual(await f.service.graph(),[]);
  assert.equal((await f.service.status()).branch,'feature.with.dots');
  const file='中文 "name"\nwith space.txt'; await f.write(file,'hello\n');
  const s=await f.service.status(); assert.equal(s.untracked,1); assert.equal(s.files[0].path,file);
  await f.service.stage(file); assert.equal((await f.service.status()).staged,1);
  await f.service.unstageAll(); assert.equal((await f.service.status()).untracked,1);
  await f.service.stageAll(); await f.service.commit('First <commit>');
  const detail=await f.service.detail('HEAD'); assert.equal(detail.parents.length,0);
  assert.equal(detail.files[0].path,file); assert.equal(detail.files[0].status,'A');
  assert.equal(await f.service.contentAt('HEAD',file),'hello\n');
  assert.equal(await f.service.contentAt('EMPTY',file),'');
});
test('separate index and worktree, rename parsing and literal pathspecs', async t => {
  const f=await fixture(t); await initial(f);
  await f.write('base.txt','staged\n'); await f.service.stage('base.txt'); await f.write('base.txt','working\n');
  let s=await f.service.status(); assert.equal(s.staged,1); assert.equal(s.changed,1); assert.equal(s.files.length,1);
  assert.equal(await f.service.contentAt('INDEX','base.txt'),'staged\n');
  await f.service.unstage('base.txt'); assert.equal((await f.service.status()).staged,0);
  f.run('restore','base.txt'); f.run('mv','base.txt','renamed.txt');
  s=await f.service.status(); assert.equal(s.files[0].oldPath,'base.txt'); assert.equal(s.files[0].path,'renamed.txt');
  await f.service.commit('rename');
  const d=await f.service.detail('HEAD'); assert.deepEqual(d.files,[{status:'R',oldPath:'base.txt',path:'renamed.txt'}]);
  assert.equal((await f.service.log(20,'renamed.txt')).length,2);
  await f.write(':(exclude)*','literal\n'); await f.write('other.txt','other\n');
  await f.service.stage(':(exclude)*'); s=await f.service.status();
  assert.equal(s.files.find(f=>f.path===':(exclude)*').index,'A'); assert.equal(s.files.find(f=>f.path==='other.txt').index,'?');
});
test('real branch topology, merge parents, typed searches, paging and comparison', async t => {
  const f=await fixture(t,'Different Author'); const base=await initial(f);
  await f.service.createBranch('feature'); await f.write('feature.txt','feature\n'); await f.service.stageAll(); await f.service.commit('Feature [literal]'); const feature=f.run('rev-parse','HEAD');
  await f.service.checkout('main'); await f.write('main.txt','main\n'); await f.service.stageAll(); await f.service.commit('Main work'); const main=f.run('rev-parse','HEAD');
  await f.service.operation('merge','feature'); const merge=f.run('rev-parse','HEAD');
  const commits=await f.service.graph(20); assert.equal(commits[0].hash,merge); assert.deepEqual(commits[0].parents,[main,feature]);
  const layout=layoutGraph(commits); assert.ok(layout.width>=2);
  assert.equal(layout.rows[0].edges.filter(e=>e.half==='bottom').length,2);
  assert.deepEqual(layout.boundary,[]);
  assert.equal((await f.service.graph(10,{query:'[literal]'})).length,1);
  assert.equal((await f.service.graph(10,{query:'different author',searchBy:'author'})).length,4);
  assert.equal((await f.service.graph(10,{query:feature.slice(0,8),searchBy:'hash'}))[0].hash,feature);
  assert.equal((await f.service.graph(1,{skip:1}))[0].hash,commits[1].hash);
  const comparison=await f.service.compare(base,merge); assert.equal(comparison.ahead,3); assert.equal(comparison.behind,0); assert.equal(comparison.files.length,2);
  assert.equal((await f.service.detail(merge)).files[0].path,'feature.txt');
});
test('tags, stash apply/pop/drop preserve the requested entry', async t => {
  const f=await fixture(t); await initial(f); await f.service.createTag('v1','HEAD');
  f.run('tag','-a','annotated','-m','Annotated version');
  assert.equal((await f.service.tags()).length,2); assert.equal((await f.service.detail('refs/tags/annotated')).hash,f.run('rev-parse','HEAD'));
  await f.service.deleteTag('v1'); assert.equal((await f.service.tags()).length,1);
  await f.write('base.txt','modified\n'); await f.write('untracked.txt','untracked\n'); await f.service.stashPush('saved');
  const [s]=await f.service.stashes(); assert.equal((await f.service.status()).files.length,0);
  const stashDetail=await f.service.detail(s.hash);
  const untracked=stashDetail.files.find(file=>file.path==='untracked.txt');
  assert.equal(untracked.from,'EMPTY'); assert.equal(await f.service.contentAt(untracked.to,untracked.path),'untracked\n');
  await f.service.stashAction('apply',s.hash); assert.equal((await f.service.status()).files.length,2);
  assert.equal((await f.service.stashes()).length,1);
  await f.service.stageAll(); await f.service.commit('Applied stash');
  await f.service.stashAction('drop',s.hash); assert.equal((await f.service.stashes()).length,0);
  await assert.rejects(f.service.stashAction('drop',s.hash));
  await f.write('base.txt','pop change\n'); await f.service.stashPush('pop');
  await f.service.stashAction('pop',(await f.service.stashes())[0].hash);
  assert.equal((await f.service.stashes()).length,0); assert.equal(await fs.readFile(path.join(f.root,'base.txt'),'utf8'),'pop change\n');
});
test('worktree create/list/remove and refusal to remove dirty worktree', async t => {
  const f=await fixture(t); await initial(f); f.run('branch','second');
  const directory=path.join(f.root,'work tree'); await f.service.createWorktree(directory,'second');
  const list=await f.service.worktrees(); assert.equal(list.length,2); assert.equal(list.find(w=>w.path===directory).branch,'second');
  await fs.writeFile(path.join(directory,'untracked'),'keep'); await assert.rejects(f.service.removeWorktree(directory));
  await fs.unlink(path.join(directory,'untracked')); await f.service.removeWorktree(directory); assert.equal((await f.service.worktrees()).length,1);
});
test('legacy worktree output preserves paths, caches unsupported -z and respects locks', async t => {
  const f=await fixture(t); await initial(f); f.run('branch','second');
  const directory=path.join(f.root,'中文 "quoted"\\path\nwork tree');
  await f.service.createWorktree(directory,'second');
  const reason='中文 "locked"\\reason\nnext\tline'; f.run('worktree','lock','--reason',reason,directory);
  const reportsLocks=f.run('worktree','list','--porcelain').includes('\nlocked ');
  const run=f.service.run.bind(f.service); let nullAttempts=0;
  f.service.run=async(args,...rest)=>{
    if(args[0]==='worktree'&&args[1]==='list'&&args.includes('-z')) {nullAttempts++;throw new GitError('Git operation failed',"error: unknown switch `z'\nusage: git worktree list [<options>]");}
    return run(args,...rest);
  };
  for(let i=0;i<2;i++) {
    const worktrees=await f.service.worktrees();assert.equal(worktrees.length,2);
    const item=worktrees.find(w=>w.path===directory);assert.ok(item);assert.equal(item.branch,'second');assert.equal(item.locked,reportsLocks?reason:undefined);
  }
  assert.equal(nullAttempts,1);
  await assert.rejects(f.service.removeWorktree(directory));
  f.run('worktree','unlock',directory); await f.service.removeWorktree(directory);
  assert.equal((await f.service.worktrees()).length,1);
});
test('legacy quoted lock reasons decode UTF-8 octal bytes and control characters', () => {
  const git=new GitService('/repo');
  git.run=async args=>{
    if(args.includes('-z'))throw new GitError('Git operation failed',"error: unknown switch `z'");
    return 'worktree /repo\nHEAD '+ 'a'.repeat(40)+'\nbranch refs/heads/main\n'+String.raw`locked "\344\270\255\346\226\207 \"locked\"\\reason\nnext\tline"`+'\n\n';
  };
  return git.worktrees().then(items=>assert.equal(items[0].locked,'中文 "locked"\\reason\nnext\tline'));
});
test('worktree failures other than unsupported -z remain visible', async t => {
  const f=await fixture(t); let attempts=0;
  f.service.run=async()=>{attempts++;throw new GitError('Git operation failed','fatal: permission denied');};
  await assert.rejects(f.service.worktrees(),e=>e.detail==='fatal: permission denied');assert.equal(attempts,1);
  f.service.run=async args=>{
    if(args.includes('-z'))throw new GitError('Git operation failed',"error: unknown switch `z'");
    throw new GitError('Git operation failed','fatal: fallback cannot read repository');
  };
  await assert.rejects(f.service.worktrees(),e=>e.detail==='fatal: fallback cannot read repository');
});
test('merge conflicts surface operation state and can be aborted', async t => {
  const f=await fixture(t); await initial(f); await f.service.createBranch('conflict');
  await f.write('base.txt','feature\n'); await f.service.stageAll(); await f.service.commit('Feature edit');
  await f.service.checkout('main'); await f.write('base.txt','main\n'); await f.service.stageAll(); await f.service.commit('Main edit');
  await assert.rejects(f.service.operation('merge','conflict'));
  assert.equal(await f.service.operationState(),'merge'); assert.equal((await f.service.status()).conflicted,1);
  await f.service.finishOperation('abort'); assert.equal(await f.service.operationState(),undefined); assert.equal((await f.service.status()).files.length,0);
});
test('blame, line history, revision option rejection and directory traversal', async t => {
  const f=await fixture(t); await initial(f);
  assert.equal((await f.service.blame('base.txt',1,1))[0].author,'Gitrism Tester');
  assert.match(await f.service.lineHistory('base.txt',1,1),/Initial commit/);
  await assert.rejects(f.service.resolveCommit('--all'));
  assert.throws(()=>f.service.filePath('../outside'));
  assert.throws(()=>f.service.filePath('/etc/passwd'));
  await assert.rejects(f.service.commit('  '));
});
test('cherry-pick, revert, rebase and conflict continuation', async t => {
  const f=await fixture(t); await initial(f);
  await f.service.createBranch('feature'); await f.write('feature.txt','feature\n'); await f.service.stageAll(); await f.service.commit('Feature');const feature=f.run('rev-parse','HEAD');
  await f.service.checkout('main');await f.write('main.txt','main\n');await f.service.stageAll();await f.service.commit('Main');
  await f.service.operation('cherry-pick',feature);assert.equal(await fs.readFile(path.join(f.root,'feature.txt'),'utf8'),'feature\n');
  await f.service.operation('revert','HEAD');await assert.rejects(fs.access(path.join(f.root,'feature.txt')));
  await f.service.checkout('feature');await f.write('unique.txt','unique\n');await f.service.stageAll();await f.service.commit('Unique feature work');
  await f.service.operation('rebase','main');assert.equal(await f.service.operationState(),undefined);
  const parent=f.run('rev-parse','HEAD^');assert.equal(parent,f.run('rev-parse','main'));
  await f.service.checkout('main');await f.write('base.txt','main\n');await f.service.stageAll();await f.service.commit('Main conflict');
  await f.service.checkout('feature');await f.write('base.txt','feature\n');await f.service.stageAll();await f.service.commit('Feature conflict');
  await assert.rejects(f.service.operation('merge','main'));await f.write('base.txt','resolved\n');await f.service.stage('base.txt');await f.service.finishOperation('continue');
  assert.equal(await f.service.operationState(),undefined);assert.equal((await f.service.detail('HEAD')).parents.length,2);
});
test('graph lanes preserve disconnected tips and boundaries', () => {
  const commits=[{hash:'a',parents:['b','c']},{hash:'d',parents:['e']},{hash:'b',parents:['e']},{hash:'c',parents:['e']},{hash:'e',parents:[]}];
  const graph=layoutGraph(commits); assert.equal(graph.rows.length,5); assert.deepEqual(graph.boundary,[]);
  assert.ok(graph.width>=3); assert.ok(graph.rows[1].lane>=2);
  const cut=layoutGraph(commits.slice(0,1)); assert.deepEqual(cut.boundary,['b','c']);
  assert.deepEqual(layoutGraph([]),{rows:[],width:1,boundary:[]});
});

test('advanced searches combine literal authors, commit dates, merge modes and first-parent history', async t => {
  const f=await fixture(t,'A [literal]');
  function commit(subject,email,day) {
    execFileSync('git',['-c','user.email='+email,'commit','--allow-empty','-m',subject],{cwd:f.root,env:{...process.env,GIT_AUTHOR_DATE:day+'T10:00:00Z',GIT_COMMITTER_DATE:day+'T10:00:00Z'}});
    return f.run('rev-parse','HEAD');
  }
  const initial=commit('base','me@example.invalid','2026-10-01');
  f.run('branch','feature');
  const own=commit('needle [literal]','ME@example.invalid','2026-10-02');
  f.run('checkout','-q','feature');const collaborator=commit('needle collaborator','other@example.invalid','2026-10-03');
  f.run('checkout','-q','main');f.run('merge','--no-ff','feature','-m','merge');
  assert.deepEqual((await f.service.graph(20,{query:'[literal]',authors:['does not exist','A [literal]'],since:'2026-10-02T00:00:00Z',until:'2026-10-02T23:59:59Z',merges:'exclude'})).map(c=>c.hash),[own]);
  assert.equal((await f.service.graph(20,{ref:'main',merges:'only'})).length,1);
  assert.ok(!(await f.service.graph(20,{ref:'main',firstParent:true})).some(c=>c.hash===collaborator));
  assert.deepEqual((await f.service.graph(20,{authorEmail:'me@example.invalid',merges:'exclude'})).map(c=>c.hash),[own,initial]);
  for(const options of [{since:'2026-02-30T00:00:00Z'},{since:'2026-10-03T00:00:00Z',until:'2026-10-01T00:00:00Z'},{authors:['bad\nauthor']},{merges:'invalid'},{authorEmail:'me@example.invalid',authors:['other']},{authorEmail:'me@example.invalid',searchBy:'author',query:'other'}])await assert.rejects(f.service.graph(20,options),GitError);
});

test('personal activity excludes same-name collaborators, merges, stash and notes; deduplicates refs and includes detached HEAD', async t => {
  const f=await fixture(t,'Same Name'), now=new Date('2026-10-10T12:00:00Z');
  const commit=(email,day)=>execFileSync('git',['-c','user.email='+email,'commit','--allow-empty','-m','activity'],{cwd:f.root,env:{...process.env,GIT_AUTHOR_DATE:day+'T10:00:00Z',GIT_COMMITTER_DATE:day+'T10:00:00Z'}});
  assert.deepEqual(await f.service.personalActivity(now),{email:'gitrism@example.invalid',timestamps:[]});
  commit('gitrism@example.invalid','2026-10-01');f.run('branch','duplicate');
  commit('other@example.invalid','2026-10-02');
  f.run('branch','feature');commit('GITRISM@example.invalid','2026-10-03');
  f.run('checkout','-q','feature');commit('other@example.invalid','2026-10-04');
  f.run('checkout','-q','main');
  execFileSync('git',['merge','--no-ff','feature','-m','merge'],{cwd:f.root,env:{...process.env,GIT_AUTHOR_DATE:'2026-10-05T10:00:00Z',GIT_COMMITTER_DATE:'2026-10-05T10:00:00Z'}});
  await f.write('stash.txt','untracked');await f.service.stashPush('exclude from activity');
  f.run('notes','add','-m','a note');
  let activity=await f.service.personalActivity(now);assert.equal(activity.timestamps.length,2);
  assert.deepEqual(activity.timestamps.sort(),['2026-10-01','2026-10-03'].map(d=>Date.parse(d+'T10:00:00Z')/1000));
  f.run('checkout','-q','--detach');commit('gitrism@example.invalid','2026-10-06');
  assert.equal((await f.service.personalActivity(now)).timestamps.length,3);
  assert.ok((await f.service.graph()).some(c=>c.hash===f.run('rev-parse','HEAD')));
  const originalRun=f.service.run.bind(f.service);
  f.service.run=async args=>{if(args[0]==='config')throw new GitError('missing',undefined,1);return originalRun(args);};
  assert.deepEqual(await f.service.personalActivity(now),{timestamps:[]});
  f.service.run=async()=>{throw new GitError('failed','permission denied',128);};
  await assert.rejects(f.service.personalActivity(now),e=>e.detail==='permission denied');
});
