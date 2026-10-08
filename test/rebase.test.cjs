const { test }=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {execFileSync}=require('node:child_process');
const {GitService}=require('../out/gitService');
async function fixture(t) {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'gitrism-rebase-test-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const run=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
  run('init','-q');run('symbolic-ref','HEAD','refs/heads/main');run('config','user.name','Gitrism Tester');run('config','user.email','gitrism@example.invalid');run('config','commit.gpgsign','false');
  const git=new GitService(root);
  const commit=async(file,body,message)=>{await fs.writeFile(path.join(root,file),body);await git.stageAll();await git.commit(message);return run('rev-parse','HEAD');};
  const base=await commit('base.txt','base\n','Base');
  return {root,run,git,commit,base};
}
test('interactive rebase reorders, squashes and drops with an immutable backup',async t=>{
  const f=await fixture(t),a=await f.commit('a.txt','a\n','A'),b=await f.commit('b.txt','b\n','B'),c=await f.commit('c.txt','c\n','C'),d=await f.commit('d.txt','d\n','D');
  const plan=await f.git.rebasePlan(f.base);assert.deepEqual(plan.commits.map(c=>c.hash),[a,b,c,d]);
  const backup=await f.git.applyRebase(plan.base,plan.head,[{hash:b,action:'pick'},{hash:a,action:'pick'},{hash:c,action:'squash'},{hash:d,action:'drop'}],plan.branch);
  assert.equal(await f.git.resolveCommit(backup),d);assert.equal(f.run('rev-list','--count',f.base+'..HEAD'),'2');
  assert.match((await f.git.detail('HEAD')).message,/A[\s\S]*C/);assert.equal((await f.git.log())[1].subject,'B');
  await assert.rejects(fs.access(path.join(f.root,'d.txt')));assert.equal(await fs.readFile(path.join(f.root,'c.txt'),'utf8'),'c\n');
  assert.equal(await f.git.operationState(),undefined);
});
test('fixup keeps the preceding message and drop can remove all commits',async t=>{
  const f=await fixture(t),a=await f.commit('a.txt','a\n','Keep message'),b=await f.commit('b.txt','b\n','Discard message');
  let plan=await f.git.rebasePlan(f.base);
  await f.git.applyRebase(plan.base,plan.head,[{hash:a,action:'pick'},{hash:b,action:'fixup'}]);
  assert.equal((await f.git.detail('HEAD')).message,'Keep message');
  plan=await f.git.rebasePlan(f.base);await f.git.applyRebase(plan.base,plan.head,plan.commits.map(c=>({hash:c.hash,action:'drop'})));
  assert.equal(await f.git.resolveCommit('HEAD'),f.base);
});
test('plan validation refuses dirty state, duplicates, first fixup and changed branch/head',async t=>{
  const f=await fixture(t),a=await f.commit('a.txt','a\n','A'),b=await f.commit('b.txt','b\n','B'),plan=await f.git.rebasePlan(f.base);
  const valid=[{hash:a,action:'pick'},{hash:b,action:'pick'}];
  await assert.rejects(f.git.applyRebase(plan.base,plan.head,[{hash:a,action:'fixup'},{hash:b,action:'pick'}]),/fixup/);
  await assert.rejects(f.git.applyRebase(plan.base,plan.head,[{hash:a,action:'pick'},{hash:a,action:'drop'}]),/duplicate/);
  await fs.writeFile(path.join(f.root,'dirty.txt'),'dirty');await assert.rejects(f.git.applyRebase(plan.base,plan.head,valid),/stash/);await fs.unlink(path.join(f.root,'dirty.txt'));
  await f.git.createBranch('other');await assert.rejects(f.git.applyRebase(plan.base,plan.head,valid,plan.branch),/branch has changed/);
  await f.git.checkout('main');await f.commit('new.txt','new\n','New');await assert.rejects(f.git.applyRebase(plan.base,plan.head,valid),/HEAD has changed/);
  assert.equal((await f.git.branches()).filter(b=>b.name.startsWith('gitrism-backup/')).length,0);
});
test('reordered conflicting patches can be aborted and the original tip is backed up',async t=>{
  const f=await fixture(t),a=await f.commit('base.txt','one\n','One'),b=await f.commit('base.txt','two\n','Two'),plan=await f.git.rebasePlan(f.base);
  await assert.rejects(f.git.applyRebase(plan.base,plan.head,[{hash:b,action:'pick'},{hash:a,action:'pick'}]),error=>error.detail.includes('Backup branch'));
  assert.equal(await f.git.operationState(),'rebase');assert.equal((await f.git.status()).conflicted,1);
  assert.equal((await f.git.branches()).filter(b=>b.name.startsWith('gitrism-backup/'))[0].hash,b);
  await f.git.finishOperation('abort');assert.equal(await f.git.resolveCommit('HEAD'),b);assert.equal((await f.git.status()).files.length,0);
});
