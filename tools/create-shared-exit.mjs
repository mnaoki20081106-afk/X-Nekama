import {generateKeyPairSync,randomBytes} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {validExitConfig} from '../exit-policy.mjs';

function keys(){
 const pair=generateKeyPairSync('x25519');
 return {private:pair.privateKey.export({format:'der',type:'pkcs8'}).subarray(-32).toString('base64'),public:pair.publicKey.export({format:'der',type:'spki'}).subarray(-32).toString('base64')};
}
export async function createSharedExit({endpointIP,exitIP=endpointIP,country='JP',publicInterface='eth0',port=51820,out}){
 if(!validExitConfig(endpointIP,country)||!validExitConfig(exitIP,country))throw Error('固定の公開IPv4と国コード（例: JP）を指定してください');
 if(!/^[a-zA-Z0-9_.-]{1,15}$/.test(publicInterface)||!Number.isInteger(port)||port<1||port>65535||!out)throw Error('インターフェース・ポート・出力先を確認してください');
 // Refuse to overwrite live keys or combine peers from previous runs.
 const destination=resolve(out);await mkdir(destination,{mode:0o700});
 const server=keys(),phone=keys(),gateway=keys();
 const token=randomBytes(32).toString('hex');
 const rules=[
  ['iptables','-A FORWARD -i %i -o '+publicInterface+' -s 10.66.66.0/24 -j ACCEPT'],
  ['iptables','-A FORWARD -i '+publicInterface+' -o %i -d 10.66.66.0/24 -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT'],
  ['iptables','-t nat -A POSTROUTING -s 10.66.66.0/24 -o '+publicInterface+' -j MASQUERADE'],
  ['ip6tables','-I FORWARD -i %i -j DROP']
 ];
 const hooks=rules.map(([tool,rule])=>`PostUp = ${tool} ${rule}\nPostDown = ${tool} ${rule.replace(/-[AI] /,'-D ')}`).join('\n');
 const serverConfig=`[Interface]\nPrivateKey = ${server.private}\nAddress = 10.66.66.1/24, fd66:66::1/64\nListenPort = ${port}\n${hooks}\n\n[Peer]\n# iPhone: unique peer, never share the gateway private key\nPublicKey = ${phone.public}\nAllowedIPs = 10.66.66.2/32, fd66:66::2/128\n\n[Peer]\n# Cloudflare egress gateway VPN client\nPublicKey = ${gateway.public}\nAllowedIPs = 10.66.66.3/32, fd66:66::3/128\n`;
 const client=(key,n)=>`[Interface]\nPrivateKey = ${key.private}\nAddress = 10.66.66.${n}/32, fd66:66::${n}/128\nDNS = 1.1.1.1\n\n[Peer]\nPublicKey = ${server.public}\nEndpoint = ${endpointIP}:${port}\nAllowedIPs = 0.0.0.0/0, ::/0\nPersistentKeepalive = 25\n`;
 const env=`X_EXIT_MODE=shared\nX_EXIT_IP=${exitIP}\nX_EXIT_COUNTRY=${country}\nX_EGRESS_TOKEN=${token}\nWIREGUARD_ENDPOINT_IP=${endpointIP}\nWIREGUARD_ENDPOINT_PORT=${port}\nWIREGUARD_PUBLIC_KEY=${server.public}\nWIREGUARD_PRIVATE_KEY=${gateway.private}\nWIREGUARD_ADDRESSES=10.66.66.3/32,fd66:66::3/128\n`;
 const files={'wg0.conf':serverConfig,'iphone.conf':client(phone,2),'gateway.conf':client(gateway,3),'.env.shared-exit':env,'99-xnekama-forward.conf':'net.ipv4.ip_forward=1\n','iphone-settings.json':JSON.stringify({mode:'shared',expected_ip:exitIP,country},null,2)+'\n'};
 for(const [name,contents] of Object.entries(files))await writeFile(join(destination,name),contents,{mode:0o600,flag:'wx'});
 return destination;
}
if(import.meta.url===new URL(process.argv[1],'file:').href){
 try{
  const args=process.argv.slice(2);const get=name=>{const index=args.indexOf(name);return index<0?undefined:args[index+1]};
  const destination=await createSharedExit({endpointIP:get('--endpoint-ip'),exitIP:get('--exit-ip')||get('--endpoint-ip'),country:get('--country')||'JP',publicInterface:get('--public-interface')||'eth0',port:Number(get('--port')||51820),out:get('--out')});
  console.log(`共通出口の設定を作成しました: ${destination}\n秘密鍵を含みます。まだVPNは起動していません。`);
 }catch(error){console.error(error.message);process.exitCode=1;}
}
