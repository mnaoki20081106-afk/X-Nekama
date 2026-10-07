import {test} from 'node:test';
import assert from 'node:assert/strict';
import {callbackURL} from '../publisher/callback.mjs';
test('relay forwards only code and state to a fixed callback',()=>{
  const state='a'.repeat(43);
  const url=new URL(callbackURL('?'+new URLSearchParams({code:'a+b/c',state,redirect:'https://attacker.example'})));
  assert.equal(url.protocol,'riri-cloudflare:');assert.equal(url.hostname,'oauth');
  assert.equal(url.searchParams.get('code'),'a+b/c');assert.equal(url.searchParams.size,2);
  assert.equal(callbackURL('?code=x&state='+state+'&state='+state),null);
  assert.equal(callbackURL('?code=x&state=wrong'),null);
  assert.equal(callbackURL('?error=access_denied&state='+state),null);
});
