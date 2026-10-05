const {test}=require('node:test');
const assert=require('node:assert/strict');
const Module=require('node:module');
let settings,updates;
const vscode={ConfigurationTarget:{Global:1,Workspace:2,WorkspaceFolder:3},workspace:{workspaceFolders:[{uri:'folder'}],getConfiguration:(section,resource)=>({inspect:key=>settings.get([section,resource||'root',key].join(':')),update:async(key,value,target)=>{
  const id=[section,resource||'root',key].join(':'),current=settings.get(id)||{};
  current[{1:'globalValue',2:'workspaceValue',3:'workspaceFolderValue'}[target]]=value;settings.set(id,current);updates.push({section,resource,key,value,target});
}})}};
const original=Module._load;Module._load=function(request,...args){return request==='vscode'?vscode:original.call(this,request,...args);};
const {migrateLegacySettings}=require('../out/settingsMigration');Module._load=original;
const context=()=>{const values=new Map();return {workspaceState:{get:key=>values.get(key),update:async(key,value)=>values.set(key,value)}};};
test('settings migration keeps explicit Gitrism values and imports each legacy scope once',async()=>{
  updates=[];settings=new Map([
    ['gitAtlas:root:sshProxy',{globalValue:'127.0.0.1:7890',workspaceValue:'127.0.0.1:7891'}],
    ['gitrism:root:sshProxy',{workspaceValue:'127.0.0.1:9999'}],
    ['gitAtlas:root:inlineBlame.enabled',{globalValue:true}],
    ['gitAtlas:folder:inlineBlame.mode',{workspaceFolderValue:'allLines'}],
    ['gitrism:folder:inlineBlame.mode',{workspaceFolderValue:'currentLine'}],
    ['gitAtlas:folder:inlineBlame.maxLines',{workspaceFolderValue:1500}]
  ]);
  const ctx=context();await migrateLegacySettings(ctx);
  assert.equal(settings.get('gitrism:root:sshProxy').globalValue,'127.0.0.1:7890');
  assert.equal(settings.get('gitrism:root:sshProxy').workspaceValue,'127.0.0.1:9999');
  assert.equal(settings.get('gitrism:root:inlineBlame.enabled').globalValue,true);
  assert.equal(settings.get('gitrism:folder:inlineBlame.mode').workspaceFolderValue,'currentLine');
  assert.equal(settings.get('gitrism:folder:inlineBlame.maxLines').workspaceFolderValue,1500);
  assert.equal(updates.length,3);await migrateLegacySettings(ctx);assert.equal(updates.length,3);
  settings.set('gitAtlas:root:inlineBlame.maxLines',{workspaceValue:2000});await migrateLegacySettings(context());
  assert.equal(settings.get('gitrism:root:inlineBlame.maxLines').workspaceValue,2000);
});
