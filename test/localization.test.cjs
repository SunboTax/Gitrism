const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ts=require('typescript');
const {resolveLocale,createTranslator}=require('../resources/i18n');
const {setLanguage,getLocale,getLocalization,t}=require('../out/localization');
const {GitService}=require('../out/gitService');
const catalogs={
  'zh-CN':require('../resources/locales/zh-cn.json'),
  'zh-TW':require('../resources/locales/zh-tw.json')
};

test('UI language resolution supports Chinese variants and falls back to English',()=>{
  for(const language of ['zh','zh-cn','zh-SG','zh-Hans','zh_Hans_CN'])assert.equal(resolveLocale(language),'zh-CN');
  for(const language of ['zh-tw','zh-HK','zh-MO','zh-Hant','zh_Hant_TW'])assert.equal(resolveLocale(language),'zh-TW');
  for(const language of ['en','en-US','de','ja',undefined,''])assert.equal(resolveLocale(language),'en');
  for(const language of ['en','zh-CN','zh-TW','de']) {
    setLanguage(language);assert.equal(getLocale(),resolveLocale(language));
    assert.equal(t('Commit graph'),catalogs[getLocale()]?.['Commit graph']||'Commit graph');
  }
  setLanguage('en');
});

test('translations preserve parameter data, support reordered placeholders and English fallback',()=>{
  const translate=createTranslator({'From {0} to {1}':'{1} ← {0}','Plain':'Translated'});
  const ref='功能/<img src=x> $& {1}';
  assert.equal(translate('From {0} to {1}',ref,'main'),'main ← '+ref);
  assert.equal(translate('Missing {0}',ref),'Missing '+ref);
  assert.equal(translate('From {0} to {1}','main'),'{1} ← main');
  assert.equal(translate('toString'),'toString');
});

test('every localized source message has complete Chinese catalogs and matching placeholders',()=>{
  assert.deepEqual(Object.keys(catalogs['zh-CN']).sort(),Object.keys(catalogs['zh-TW']).sort());
  const placeholders=text=>[...text.matchAll(/\{\d+\}/g)].map(m=>m[0]).sort();
  for(const [locale,catalog] of Object.entries(catalogs))for(const [key,value] of Object.entries(catalog)) {
    assert.ok(value.length>0,locale+': '+key);
    assert.deepEqual(placeholders(value),placeholders(key),locale+': '+key);
  }
  const files=['resources/workspace.js',...fs.readdirSync(path.join(__dirname,'../src')).filter(f=>f.endsWith('.ts')).map(f=>'src/'+f)];
  for(const file of files) {
    const text=fs.readFileSync(path.join(__dirname,'..',file),'utf8');
    assert.doesNotMatch(text,/\p{Script=Han}/u,'UI text should live in catalogs: '+file);
    const source=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true);
    function visit(node) {
      if(ts.isCallExpression(node)&&ts.isIdentifier(node.expression)&&['t','tr'].includes(node.expression.text)&&node.arguments[0]&&(ts.isStringLiteral(node.arguments[0])||ts.isNoSubstitutionTemplateLiteral(node.arguments[0]))) {
        const key=node.arguments[0].text;
        for(const [locale,catalog] of Object.entries(catalogs))assert.ok(Object.hasOwn(catalog,key),locale+' missing '+key+' in '+file);
      }
      ts.forEachChild(node,visit);
    }
    visit(source);
  }
});

test('all native manifest strings resolve in English, Simplified Chinese and Traditional Chinese',()=>{
  const manifest=require('../package.json');
  const bundles=['../package.nls.json','../package.nls.zh-cn.json','../package.nls.zh-tw.json'].map(require);
  const text=JSON.stringify(manifest),keys=[...text.matchAll(/%([\w.]+)%/g)].map(m=>m[1]);
  assert.ok(keys.length>=19);
  for(const key of keys)for(const bundle of bundles)assert.equal(typeof bundle[key],'string',key);
  assert.deepEqual(Object.keys(bundles[0]).sort(),Object.keys(bundles[1]).sort());
  assert.deepEqual(Object.keys(bundles[0]).sort(),Object.keys(bundles[2]).sort());
  assert.equal(bundles[1]['command.openGraph'],'Gitrism: 打开提交图');
  assert.equal(bundles[2]['command.openGraph'],'Gitrism: 開啟提交圖');
});

test('Git validation errors follow the selected UI language without requiring VS Code',()=>{
  const git=new GitService('/repository');
  for(const locale of ['en','zh-CN','zh-TW']) {
    setLanguage(locale);
    assert.throws(()=>git.filePath('../escape'),error=>error.message===(catalogs[locale]?.['Invalid repository file path']||'Invalid repository file path'));
  }
  setLanguage('en');
});
