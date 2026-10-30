const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {InlineBlameCache}=require('../out/inlineBlame');
const entry=(author,summary)=>({hash:(author==='A'?'a':'b').repeat(40),author,date:'2026-10-20T00:00:00Z',summary});

test('line attribution reads and caches individual lines; whole-file mode stays explicit',async()=>{
  const calls=[];
  const repo={cwd:'/repo',blame:async(file,start,end)=>{calls.push([file,start,end]);return start===2?[entry('B','Second line')]:[entry('A','First line'),entry('B','Second line')];}};
  const cache=new InlineBlameCache();
  const second=await cache.query(repo,'two authors.ts',1,1,false);
  assert.deepEqual(calls,[['two authors.ts',2,2]]);
  assert.deepEqual(second,[{line:1,entry:entry('B','Second line')}]);
  await cache.query(repo,'two authors.ts',1,1,false);assert.equal(calls.length,1);
  await cache.query(repo,'two authors.ts',2,1,false);assert.equal(calls.length,2);
  cache.clear();await cache.query(repo,'two authors.ts',2,1,false);assert.equal(calls.length,3);
  const all=await cache.query(repo,'two authors.ts',2,1,true);
  assert.deepEqual(calls.at(-1),['two authors.ts',undefined,undefined]);
  assert.deepEqual(all.map(x=>x.line),[0,1]);
});

test('failed blame reads can be retried and simultaneous reads share the pending request',async()=>{
  const cache=new InlineBlameCache();let reads=0,finish;
  const repo={cwd:'/repo',blame:()=>{reads++;return new Promise(resolve=>finish=resolve);}};
  const a=cache.query(repo,'f',1,0,false),b=cache.query(repo,'f',1,0,false);
  assert.equal(reads,1);finish([entry('A','One')]);assert.deepEqual(await a,await b);
  repo.blame=async()=>{throw new Error('untracked');};
  await assert.rejects(cache.query(repo,'other',1,0,false),/untracked/);
  repo.blame=async()=>[entry('B','Now tracked')];
  assert.equal((await cache.query(repo,'other',1,0,false))[0].entry.author,'B');
});

// Exercise the actual extension renderer without requiring a running VS Code host.
function extension(repo,lineCount=20000){
  let decorations=[]; const paints=[];
  const doc={uri:{scheme:'file',fsPath:'/repo/module.ts'},version:1,isDirty:false,isClosed:false,lineCount};
  const editor={document:doc,selection:{active:{line:1}},setDecorations:(_,items)=>{decorations=items;paints.push(items);}};
  const settings={mode:'currentLine',maxLines:1000};
  const api={
    Range:class{constructor(sl,sc,el,ec){this.start={line:sl,character:sc};this.end={line:el,character:ec};}},
    MarkdownString:class{value='';appendText(s){this.value+=s;}appendMarkdown(s){this.value+=s;}},
    window:{activeTextEditor:editor,visibleTextEditors:[editor]},
    workspace:{getConfiguration:()=>({get:(key,fallback)=>settings[key]??fallback})}
  };
  const context={exports:{},setTimeout,clearTimeout,require:name=>{
    if(name==='vscode')return api;
    if(name==='node:path')return require(name);
    if(['./inlineBlame','./localization','./gitService'].includes(name))return require('../out/'+name.slice(2));
    return {};
  }};
  // Expose the renderer and its cancellation scheduler only within the test context.
  vm.runInNewContext(fs.readFileSync(require.resolve('../out/extension'),'utf8')+`
    git = repositories[0] = globalThis.repository;
    inlineBlameEnabled = true; blameDecoration = {dispose(){}};
    globalThis.renderer = {update:updateInlineBlame,schedule:scheduleBlame,invalidate:()=>blameCache.clear()};
  `, Object.assign(context,{repository:repo}));
  return {editor,doc,api,settings,paints,get decorations(){return decorations;},...context.renderer,stop:()=>context.exports.deactivate()};
}

test('VS Code decorates only the cursor line even in a large file; allLines obeys its limit',async()=>{
  const calls=[];
  const host=extension({cwd:'/repo',blame:async(...args)=>{calls.push(args);return [entry('B','Changed this line')];}});
  try{
    await host.update();assert.deepEqual(calls,[['module.ts',2,2]]);
    assert.equal(host.decorations.length,1);assert.equal(host.decorations[0].range.start.line,1);
    assert.match(host.decorations[0].renderOptions.after.contentText,/B.*Changed this line/);
    assert.match(host.decorations[0].hoverMessage.value,/command:gitrism.showCommit/);
    host.settings.mode='allLines';await host.update();assert.equal(calls.length,1);assert.equal(host.decorations.length,0);
  }finally{host.stop();}
});

test('VS Code drops stale line results immediately on cursor changes, dirty buffers and editor switches',async()=>{
  let finish;
  const host=extension({cwd:'/repo',blame:()=>new Promise(resolve=>finish=resolve)});
  try{
    let pending=host.update();host.editor.selection.active.line=2;host.schedule();finish([entry('A','Old line')]);await pending;
    assert.equal(host.decorations.length,0);
    pending=host.update();host.doc.isDirty=true;finish([entry('B','Now dirty')]);await pending;
    assert.equal(host.decorations.length,0);
    host.doc.isDirty=false;host.editor.selection.active.line=3;
    pending=host.update();host.api.window.activeTextEditor=undefined;finish([entry('B','Inactive editor')]);await pending;
    assert.equal(host.decorations.length,0);
  }finally{host.stop();}
});

test('same-line refresh keeps attribution painted during reads and skips identical redraws',async()=>{
  let reads=0,finish;
  const repo={cwd:'/repo',blame:async()=>{reads++;return [entry('A','Stable annotation')];}};
  const host=extension(repo);
  try {
    await host.update();assert.equal(host.paints.length,1);
    host.schedule();assert.equal(host.decorations.length,1);
    await host.update();assert.equal(host.paints.length,1);assert.equal(reads,1);
    host.invalidate();repo.blame=()=>new Promise(resolve=>finish=resolve);
    host.schedule();const pending=host.update();
    assert.equal(host.paints.length,1);assert.equal(host.decorations.length,1);
    finish([entry('A','Stable annotation')]);await pending;
    assert.equal(host.paints.length,1);
    host.invalidate();const changed=host.update();
    finish([entry('B','Updated annotation')]);await changed;
    assert.equal(host.paints.length,2);assert.equal(host.decorations.length,1);
    assert.match(host.decorations[0].renderOptions.after.contentText,/Updated annotation/);
    assert.ok(host.paints.every(items=>items.length===1),'No empty frame between old and new attribution');
    host.editor.selection.active.line=2;host.schedule();assert.equal(host.decorations.length,0);
  } finally {host.stop();}
});

test('whole-file annotations stay painted across line movement and clear immediately on edits',async()=>{
  const host=extension({cwd:'/repo',blame:async()=>[entry('A','One'),entry('B','Two')]},10);
  try {
    host.settings.mode='allLines';await host.update();assert.equal(host.paints.length,1);
    host.editor.selection.active.line=3;host.schedule();await host.update();
    assert.equal(host.paints.length,1);assert.equal(host.decorations.length,2);
    host.doc.isDirty=true;host.doc.version++;host.schedule();assert.equal(host.decorations.length,0);
  }finally{host.stop();}
});
