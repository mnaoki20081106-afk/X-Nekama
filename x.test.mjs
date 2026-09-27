import test from 'node:test';
import assert from 'node:assert/strict';
import * as x from './x.mjs';

test('X transport exposes only XActions session operations',()=>{
 assert.equal(typeof x.login,'function');
 assert.equal(typeof x.verify,'function');
 assert.equal(typeof x.ensureBio,'function');
 assert.equal(typeof x.checkBio,'function');
 assert.equal(typeof x.collect,'function');
 assert.equal(typeof x.publish,'function');
 assert.equal('publishApi' in x,false);
 assert.equal('verifyApiToken' in x,false);
 assert.equal('checkApiBio' in x,false);
});
