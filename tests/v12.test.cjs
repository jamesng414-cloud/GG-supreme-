const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const {webcrypto}=require('node:crypto');
const root=path.join(__dirname,'..');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const source=html.match(/<script>([\s\S]*?)<\/script>/)[1];
const csv=fs.readFileSync(path.join(root,'toto_prizes.csv'),'utf8');
const keys={manual:'gg-supreme-v10-manual-draws',history:'gg-supreme-v6-candidates',tracker:'gg-supreme-v7-tracker',cache:'gg-supreme-v12-automatic-draws'};

class Element{
 constructor(){this.children=[];this.listeners={};this.value='';this.disabled=false;this.text='';this.html='';this.files=[];}
 append(...nodes){this.children.push(...nodes)}
 replaceChildren(...nodes){this.text='';this.html='';this.children=[...nodes]}
 set textContent(value){this.text=String(value);this.html='';this.children=[]}
 get textContent(){return this.text+this.html+this.children.map(x=>typeof x==='string'?x:x.textContent).join('')}
 set innerHTML(value){this.html=String(value);this.text='';this.children=[]}
 get innerHTML(){return this.html}
 addEventListener(name,fn){(this.listeners[name]??=[]).push(fn)}
 async click(){for(const fn of this.listeners.click??[])await fn({target:this})}
}
class Memory{
 constructor(initial){this.data=new Map(Object.entries(initial));this.failKey=null;}
 getItem(key){return this.data.get(key)??null}
 setItem(key,value){if(this.failKey===key)throw Error('QuotaExceededError');this.data.set(key,String(value))}
 removeItem(key){this.data.delete(key)}
}
async function app(initial={}){
 const elements=new Map(),storage=new Memory(initial),alerts=[];
 const el=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id)};
 el('count').value='100';el('method').value='core';el('backtestCount').value='100';
 const numberInputs=Array.from({length:6},()=>new Element());
 const context=vm.createContext({
  document:{getElementById:el,createElement:()=>new Element(),createTextNode:text=>String(text),querySelectorAll:()=>numberInputs},
  localStorage:storage,window:{crypto:webcrypto},Intl,Date,Uint32Array,Blob,AbortSignal:{timeout:()=>undefined},
  URL:{createObjectURL:()=> 'blob:fixture',revokeObjectURL:()=>{}},setTimeout:()=>0,
  fetch:async()=>{throw Error('Fixture network unavailable')},alert:text=>alerts.push(text),confirm:()=>true,
 });
 vm.runInContext(source,context);await vm.runInContext('refreshDraws(true)',context);
 const run=code=>vm.runInContext(code,context),json=code=>JSON.parse(JSON.stringify(run(code)));
 return {context,storage,el,run,json,alerts,numberInputs};
}
function real(a){a.context.csvFixture=csv;a.run('loadCSV(csvFixture)');return a.json('draws')}
function trackerRecord(extra={}){return {createdAt:'2026-10-28T11:00:00.000Z',method:'旧版记录',nums:[5,9,19,27,31,41],targetId:4230,afterId:4229,...extra}}
function generatedRecord(extra={}){return {time:'2026/10/28 19:00',method:'旧版记录',nums:[5,9,19,27,31,41],...extra}}

test('inline JavaScript compiles and offline bootstrap settles without losing cached/manual data',async()=>{
 const manual={id:4231,date:'2026/11/02',nums:[1,2,3,4,5,6],extra:7};
 const a=await app({[keys.manual]:JSON.stringify([manual])});
 assert.equal(a.json('draws.at(-1).id'),4231);
 assert.match(a.el('syncState').textContent,/第 4231 期/);
 assert.equal(a.el('fetch').disabled,false);
 assert.deepEqual(JSON.parse(a.storage.getItem(keys.manual)),[manual]);
});
test('real CSV parsing keeps the existing 1238 valid draws and excludes the extra ball',async()=>{
 const a=await app();const rows=real(a);
 assert.equal(rows.length,1238);assert.equal(rows.at(-1).id,4230);
 assert.deepEqual(rows.at(-1).nums,[5,9,19,31,41,48]);assert.equal(rows.at(-1).extra,27);
 const bad=csv.replace("['05', '09', '19', '31', '41', '48', '27']","['05', '05', '19', '31', '41', '48', '27']");
 a.context.bad=bad;assert.equal(a.json('parseCSV(bad).output').length,1237);
 a.context.short=csv.split('\n').slice(0,20).join('\n');
 assert.throws(()=>a.run('loadCSV(short)'));
 assert.equal(a.json('automaticDraws.length'),1238);
});
test('every mode generates exactly one valid set and appends exactly one history/tracker record',async()=>{
 const a=await app();real(a);
 for(const mode of ['core','random','frequency','balanced']){
  a.el('method').value=mode;await a.el('generate').click();
  const history=a.json('getHistory()'),record=history[0];
  assert.equal(record.nums.length,6);assert.equal(new Set(record.nums).size,6);
  assert.ok(record.nums.every(n=>Number.isInteger(n)&&n>=1&&n<=49));
  assert.equal(a.el('prediction').children.length,1);
  assert.equal(a.json('getTracker().length'),history.length);
 }
 assert.equal(a.json('getHistory().length'),4);
 assert.equal(a.json('getTracker()[0].targetId'),4231);
});
test('core picks are deterministic and do not mutate the history',async()=>{
 const a=await app();real(a);const before=a.json('draws');
 assert.deepEqual(a.json('corePick(draws.slice(-100))'),a.json('corePick(draws.slice(-100))'));
 assert.deepEqual(a.json('draws'),before);
 assert.throws(()=>a.run('corePick(draws.slice(0,29))'));
 assert.equal(a.json('valid(null)'),false);
});
test('walk-forward backtest uses the selected window and excludes target/future numbers',async()=>{
 const a=await app();real(a);
 const result=a.json('backtestCore(draws,100,100)');
 assert.equal(result.count,100);assert.equal(result.results.core.reduce((a,b)=>a+b),100);
 assert.ok(result.rows.every(r=>r.afterId<r.targetId&&r.historyCount===100));
 assert.deepEqual(result,a.json('backtestCore(draws,100,100)'));
 a.run('const altered=draws.map(d=>({...d,nums:[...d.nums]}));altered[altered.length-1].nums=[1,2,3,4,6,7];altered[altered.length-1].extra=8');
 const changed=a.json('backtestCore(altered,100,100)');
 assert.deepEqual(result.rows.map(r=>r.core),changed.rows.map(r=>r.core));
 assert.deepEqual(result.rows.map(r=>r.random),changed.rows.map(r=>r.random));
 assert.equal(a.json('backtestCore(draws,1,300).rows[0].historyCount'),300);
 assert.equal(a.json('backtestCore(draws,1,Infinity).rows[0].historyCount'),1237);
 assert.throws(()=>a.run('backtestCore(draws,0,100)'));
 assert.throws(()=>a.run('backtestCore([...draws].reverse(),100,100)'));
});
test('automatic matching counts main balls only, uses Singapore dates, and labels same-day uncertainty',async()=>{
 const a=await app({[keys.tracker]:JSON.stringify([trackerRecord()])});real(a);
 assert.equal(a.json('matching(getTracker()[0]).hits'),5);
 a.context.record=trackerRecord({createdAt:'2026-10-28T18:30:00.000Z'});
 assert.equal(a.json('matching(record).uncertain'),true);
 a.context.record=trackerRecord({createdAt:'2026-10-30T00:00:00.000Z'});
 assert.equal(a.json('matching(record).invalid'),true);
 a.context.record=trackerRecord({targetId:9999});assert.equal(a.json('matching(record)'),null);
 a.run('renderTracker()');assert.match(a.el('trackerSummary').textContent,/已核对并计成绩 1 组/);
});
test('old V10.1 backups merge, preserve conflicts, retain all records and restore idempotently',async()=>{
 const old={id:4231,date:'2026/11/02',nums:[1,2,3,4,5,6],extra:7};
 const a=await app({[keys.manual]:JSON.stringify([old]),[keys.history]:JSON.stringify([generatedRecord()]),[keys.tracker]:JSON.stringify([trackerRecord()])});real(a);
 const backup={format:'gg-supreme-v10.1',manualDraws:[{...old,nums:[8,9,10,11,12,13],extra:14}],tracker:Array.from({length:510},(_,i)=>trackerRecord({method:'import-'+i})),generated:Array.from({length:40},(_,i)=>generatedRecord({method:'import-'+i}))};
 a.context.backup=backup;assert.equal(a.json('restoreBackup(backup).conflicts'),1);
 assert.deepEqual(a.json('getV10Manual()[0].nums'),old.nums);
 assert.equal(a.json('getTracker().length'),511);assert.equal(a.json('getHistory().length'),41);
 a.run('restoreBackup(backup)');assert.equal(a.json('getTracker().length'),511);
 assert.equal(a.json('automaticDraws.length'),1238);
 const exported=a.json('buildBackup()');assert.equal(exported.automaticDraws.length,1238);assert.equal(exported.generated.length,41);
});
test('corrupt backups fail before writes and storage failure rolls back the whole restore',async()=>{
 const a=await app({[keys.history]:JSON.stringify([generatedRecord()])});real(a);
 const before=[...a.storage.data];
 a.context.backup={manualDraws:[null],tracker:[],generated:[]};assert.throws(()=>a.run('restoreBackup(backup)'));
 assert.deepEqual([...a.storage.data],before);
 a.context.backup={manualDraws:[{id:9999,date:'2099/01/01',nums:[1,2,3,4,5,6],extra:7}],tracker:[],generated:[]};
 assert.throws(()=>a.run('restoreBackup(backup)'));assert.deepEqual([...a.storage.data],before);
 a.context.backup={manualDraws:[{id:4231,date:'2026/11/02',nums:[1,2,3,4,5,6],extra:7}],tracker:[trackerRecord()],generated:[]};
 a.storage.failKey=keys.tracker;assert.throws(()=>a.run('restoreBackup(backup)'));
 assert.deepEqual([...a.storage.data].sort(),[...before].sort());
});
test('malformed legacy records do not crash rendering and unreadable storage is never overwritten',async()=>{
 const a=await app({[keys.history]:'[null,{"nums":null}]',[keys.tracker]:'{broken'});real(a);
 const previous=a.storage.getItem(keys.tracker);await a.el('generate').click();
 assert.equal(a.storage.getItem(keys.tracker),previous);
 assert.equal(a.storage.getItem(keys.history),'[null,{"nums":null}]');
 assert.match(a.el('prediction').textContent,/无法读取/);
});
test('demo data and short CSV imports never destroy real data or score fabricated results',async()=>{
 const a=await app({[keys.tracker]:JSON.stringify([trackerRecord()])});real(a);
 const before=a.storage.getItem(keys.tracker);await a.el('demo').click();
 assert.equal(a.json('draws.length'),7);assert.equal(a.json('realDraws().length'),1238);
 assert.equal(a.json('matching(getTracker()[0]).hits'),5);
 a.el('method').value='random';await a.el('generate').click();
 assert.equal(a.storage.getItem(keys.tracker),before);
 await a.run('refreshDraws(false)');assert.equal(a.json('draws.length'),1238);
});
