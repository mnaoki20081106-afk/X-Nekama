import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const runtimeFiles=[
  'x.mjs',
  'server.mjs',
  'db.mjs',
  'public/app.js',
  'public/index.html',
  'cloudflare/src/index.mjs',
  'cloudflare/wrangler.ci.toml',
  'cloudflare/wrangler.toml.example'
];

test('runtime never depends on paid X Developer API',async()=>{
  const forbidden=[
    'X_CLIENT_ID',
    'X_CLIENT_SECRET',
    'api_access_token',
    'access_token_cipher',
    'refresh_token_cipher',
    '/2/tweets',
    '/2/media/upload',
    'verifyApiToken(',
    'publishApi(',
    'checkApiBio(',
    'startOAuth(',
    'finishOAuth('
  ];
  for(const file of runtimeFiles){
    const source=await readFile(file,'utf8');
    for(const token of forbidden){
      assert.equal(source.includes(token),false,`${file} must not contain paid X API dependency: ${token}`);
    }
  }
});

test('Cloudflare public runtime uses encrypted XActions sessions',async()=>{
  const source=await readFile('cloudflare/src/index.mjs','utf8');
  assert.match(source,/import \* as xactions from '\.\.\/\.\.\/x\.mjs'/);
  assert.match(source,/path==='\/api\/x-session'/);
  assert.match(source,/await xactions\.verify\(cookies\)/);
  assert.match(source,/await xactions\.login\(username,password,email\)/);
  assert.match(source,/await xactions\.publish\(cookies,draft\.text,tempPath/);
  assert.match(source,/seal\(env,resolved\.cookies,/);
});

test('Node runtime uses XActions session posting only',async()=>{
  const source=await readFile('server.mjs','utf8');
  assert.match(source,/await x\.checkBio\(cookies,a\.username\)/);
  assert.match(source,/await x\.publish\(cookies,d\.text,imagePath/);
  assert.doesNotMatch(source,/publishApi|checkApiBio|api_token_cipher/);
});
