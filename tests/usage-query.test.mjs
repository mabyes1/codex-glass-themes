import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import assert from 'node:assert/strict';
import test from 'node:test';
const source=readFileSync(new URL('../packaging/payload/theme/theme-panel.js',import.meta.url),'utf8');
const body=source.slice(source.indexOf('  function usageQuery()'),source.indexOf('  function render()'));
const q=(key,active,data={rate_limit:{}})=>({queryKey:key,state:{data},getObserversCount:()=>active});
const select=queries=>runInNewContext(body+';usageQuery()',{client:{getQueryCache:()=>({findAll:()=>queries})}});
test('account-scoped usage selects active account and excludes image quota',()=>{
 const old=q(['rate-limit-status','old','account'],0),current=q(['rate-limit-status','current','account'],1),image=q(['rate-limit-status','image-generation'],1);
 assert.equal(select([image,old,current]),current);
 assert.equal(select([old]),undefined);
});
test('legacy key remains supported and unloaded scoped queries stay empty',()=>{
 const legacy=q(['rate-limit-status'],0);assert.equal(select([legacy]),legacy);
 assert.equal(select([q(['rate-limit-status','current'],1,null)]),undefined);
});
