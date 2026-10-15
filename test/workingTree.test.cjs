const {test}=require('node:test');
const assert=require('node:assert/strict');
const {build}=require('../resources/workingTree');

test('changed-file hierarchy groups full paths, counts descendants and sorts directories before files',()=>{
  const files=['src/z/index.ts','README.md','src/a/index.ts','test/a.test.ts','src/app.ts'].map(path=>({path}));
  const tree=build(files);
  assert.equal(tree.count,5);assert.deepEqual([...tree.directories.keys()],['src','test']);
  const src=tree.directories.get('src');assert.equal(src.count,3);
  assert.deepEqual([...src.directories.keys()],['a','z']);
  assert.equal(src.directories.get('a').path,'src/a');assert.equal(src.directories.get('a').files[0],files[2]);
  assert.deepEqual(tree.files.map(f=>f.path),['README.md']);assert.deepEqual(files.map(f=>f.path),['src/z/index.ts','README.md','src/a/index.ts','test/a.test.ts','src/app.ts']);
});

test('hierarchy preserves renamed, deleted, conflicted and unusual paths without object-key collisions',()=>{
  const files=[{path:'__proto__/constructor/file.ts',oldPath:'old/file.ts',index:'R',working:' '},
    {path:'a/b/file.txt',index:'D'},{path:'x/b/file.txt',conflict:true},
    {path:'中文 "quoted"/line\nfile.ts'},{path:'<img src=x>/evil.txt'}];
  const tree=build(files);
  assert.equal(tree.directories.get('__proto__').directories.get('constructor').files[0],files[0]);
  assert.equal(tree.directories.get('a').directories.get('b').path,'a/b');
  assert.equal(tree.directories.get('x').directories.get('b').path,'x/b');
  assert.equal(tree.directories.get('中文 "quoted"').files[0].path,files[3].path);
  assert.equal(tree.count,5);assert.equal(build([]).count,0);
});
