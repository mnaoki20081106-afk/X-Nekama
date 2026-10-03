// Pin every provisioning command to a single account the current login can use.
export function selectCloudflareAccount(identity,{requested='',saved=''}={}){
 const accounts=identity?.accounts||[];
 const valid=id=>/^[a-f0-9]{32}$/i.test(id);
 if(requested&&!valid(requested))throw Error('CLOUDFLARE_ACCOUNT_ID は32桁のアカウントIDで指定してください');
 if(saved&&!valid(saved))throw Error('保存済みのCloudflareアカウントIDが不正です');
 if(requested&&saved&&requested!==saved)throw Error('既存サーバーとは別のCloudflareアカウントです。別の作業フォルダでセットアップしてください');
 const id=requested||saved;
 if(id){
  const account=accounts.find(a=>a.id===id);
  if(!account)throw Error('指定したCloudflareアカウントへのアクセスを確認できません');
  return account;
 }
 if(accounts.length!==1)throw Error('配置先を選んで CLOUDFLARE_ACCOUNT_ID を設定してください。CloudflareダッシュボードのアカウントIDを使用します');
 if(!valid(accounts[0].id))throw Error('CloudflareアカウントIDを取得できません');
 return accounts[0];
}
