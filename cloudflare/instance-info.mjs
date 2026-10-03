export function instanceInfo(env){
 return {product:'x-nekama',protocol_version:1,platform:'cloudflare-workers',deployment_model:'user-account',
  vpn_egress_configured:!!env.X_EGRESS_URL&&String(env.X_EGRESS_TOKEN||'').length>=24,
  exit_mode:env.X_EXIT_MODE==='shared'?'shared':'warp'};
}
