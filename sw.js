/* Calibrated Golf v8.9.113: redirect-safe offline app launches. */
'use strict';
const SHELL_CACHE='calibrated-golf-shell-v8.9.113';
const PREFIX='calibrated-golf-shell-';
const APP_ROOT=new URL('./',self.registration.scope);
const SHELL_KEY=APP_ROOT.href;
let warmInProgress=false;
function isShell(req,url){
 if(req.method!=='GET'||url.origin!==APP_ROOT.origin)return false;
 const path=url.pathname.toLowerCase();
 return path===APP_ROOT.pathname.toLowerCase()||path===new URL('index.html',APP_ROOT).pathname.toLowerCase();
}
function isValidHtml(response){return response&&response.ok&&(response.headers.get('content-type')||'').toLowerCase().includes('text/html');}
async function safeShellResponse(response){
 if(!isValidHtml(response))return null;
 // A fetched or cached response can retain a redirect URL list. iOS rejects
 // that response for a navigation. Rebuild it with the same HTML and headers.
 const headers=new Headers(response.headers);
 headers.delete('content-encoding');headers.delete('content-length');headers.delete('transfer-encoding');
 return new Response(response.body||await response.blob(),{status:response.status,statusText:response.statusText,headers});
}
async function findStoredShell(){
 const own=await caches.open(SHELL_CACHE);
 let found=await own.match(SHELL_KEY,{ignoreSearch:true});
 if(isValidHtml(found))return safeShellResponse(found);
 const names=(await caches.keys()).filter(n=>n.startsWith(PREFIX)&&n!==SHELL_CACHE).reverse();
 for(const name of names){
  const cache=await caches.open(name);
  for(const key of await cache.keys()){
   const url=new URL(key.url);
   if(!isShell(new Request(key.url),url))continue;
   found=await cache.match(key);
   if(isValidHtml(found))return safeShellResponse(found);
  }
 }
 return null;
}
async function storeShell(response){
 const safe=await safeShellResponse(response);if(!safe)return;
 const cache=await caches.open(SHELL_CACHE);await cache.put(SHELL_KEY,safe);
 // Leave legacy caches intact during recovery. Only this worker's own
 // shell entry is replaced; unrelated caches and user storage are untouched.
}
function boundedNetwork(req){
 const ac=new AbortController(),timer=setTimeout(()=>ac.abort(),12000);
 return fetch(req,{cache:'no-store',redirect:'follow',signal:ac.signal}).finally(()=>clearTimeout(timer));
}
self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
 // Migrate the existing offline HTML without downloading it again and without
 // touching localStorage, IndexedDB, saved rounds, settings or sign-in data.
 try{const stored=await findStoredShell();if(stored)await storeShell(stored);}catch(_){}
 await self.clients.claim();
})()));
self.addEventListener('fetch',event=>{
 const req=event.request;if(req.method!=='GET')return;
 const url=new URL(req.url);if(url.origin!==APP_ROOT.origin)return;
 if(/\/(version\.json|sw\.js)$/i.test(url.pathname)){event.respondWith(fetch(req,{cache:'no-store'}));return;}
 if(!isShell(req,url))return;
 const forced=['cg_build','cg_cb','cg_recovered'].some(k=>url.searchParams.has(k));
 event.respondWith((async()=>{
  if(!forced){const cached=await findStoredShell();if(cached)return cached;}
  try{
   const response=await boundedNetwork(req);
   const safe=await safeShellResponse(response);
   if(safe){event.waitUntil(storeShell(safe.clone()).catch(()=>{}));return safe;}
   return await findStoredShell()||response;
  }catch(_){return await findStoredShell()||new Response('Offline: Calibrated Golf is not yet cached. Please connect to the internet and reopen the app.',{status:503,headers:{'Content-Type':'text/plain; charset=utf-8'}});}
 })());
});
self.addEventListener('message',event=>{
 const data=event.data||{};
 if(data.type==='CG_STARTUP_STATUS'){event.ports?.[0]?.postMessage({version:'8.9.113',redirectSafe:true});return;}
 if(data.type==='SKIP_WAITING'){event.waitUntil(self.skipWaiting());return;}
 if(data.type!=='CACHE_CURRENT_PAGE'||warmInProgress)return;
 warmInProgress=true;
 event.waitUntil((async()=>{
  try{if(await findStoredShell())return;const response=await boundedNetwork(APP_ROOT.href);if(isValidHtml(response))await storeShell(response);}
  catch(_){}finally{warmInProgress=false;}
 })());
});
