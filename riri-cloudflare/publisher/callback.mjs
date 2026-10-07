// Static HTTPS relay: no token exchange, cookies, analytics, or remote resources.
export function callbackURL(search) {
  const params=new URLSearchParams(search);
  if(params.getAll('code').length!==1||params.getAll('state').length!==1) return null;
  const code=params.get('code'),state=params.get('state');
  if(!/^[A-Za-z0-9_-]{43}$/.test(state)||!code||code.length>2048||/[\x00-\x20\x7f]/.test(code)) return null;
  const url=new URL('riri-cloudflare://oauth/callback');
  url.search=new URLSearchParams({code,state}).toString();return url.href;
}
if(typeof window!=='undefined') {
  const target=callbackURL(window.location.search);
  window.history.replaceState(null,'',window.location.pathname);
  if(target) {
    const link=document.getElementById('return');link.href=target;link.hidden=false;
    window.location.replace(target);
  } else document.getElementById('status').textContent='認証結果を確認できません。アプリからやり直してください。';
}
