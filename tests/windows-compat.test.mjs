import {test} from 'node:test';
import assert from 'node:assert/strict';
import {getWindowsAppearancePolicy} from '../packaging/payload/theme/windows-compat.mjs';
test('Windows 10 and early Windows 11 use renderer glass',()=>{
 for(const version of ['10.0.19045','10.0.22000'])assert.equal(getWindowsAppearancePolicy(version).compatibility,true);
});
test('Windows 11 native backdrop support is preserved',()=>{
 for(const version of ['10.0.22621','10.0.26100','10.0.26200'])assert.equal(getWindowsAppearancePolicy(version).compatibility,false);
});
test('unsupported and malformed versions fail closed',()=>{
 for(const version of ['10.0.19044','6.3.9600','unknown'])assert.throws(()=>getWindowsAppearancePolicy(version));
});
