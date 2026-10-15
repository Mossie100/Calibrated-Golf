/* Calibrated Golf v8.8.112: fast offline-first launches, explicit online updates. */
'use strict';
const SHELL_CACHE='calibrated-golf-shell-v8.8.112';
const PREFIX='calibrated-golf-shell-';
const APP_ROOT=new URL('./',self.registration.scope);
const SHELL_KEY=new URL('Index.html',APP_ROOT).href;
let warmInProgress=false;
self.addEventListener('install',event=>{event.waitUntil(self.skipWaiting());});
self.addEventListener('activate',event=>{event.waitUntil(self.clients.claim());});
function isShell(req,url){
 if(req.method!=='GET'||url.origin!==APP_ROOT.origin)return false;
 const path=url.pathname.toLowerCase();
 return path===APP_ROOT.pathname.toLowerCase()||path===new URL('index.html',APP_ROOT).pathname.toLowerCase();
}
function isValidHtml(response){
 return response&&response.ok&&(response.headers.get('content-type')||'').toLowerCase().includes('text/html');
}
async function findStoredShell(){
 const own=await caches.open(SHELL_CACHE);
 let found=await own.match(SHELL_KEY,{ignoreSearch:true});
 if(found)return found;
 const names=(await caches.keys()).filter(name=>name.startsWith(PREFIX)&&name!==SHELL_CACHE).reverse();
 for(const name of names){
  const cache=await caches.open(name);
  const keys=await cache.keys();
  for(const key of keys){
   const url=new URL(key.url);
   if(url.origin!==APP_ROOT.origin||!isShell(new Request(key.url),url))continue;
   found=await cache.match(key);
   if(found)return found;
  }
 }
 return null;
}
async function storeShell(response){
 if(!isValidHtml(response))return;
 const cache=await caches.open(SHELL_CACHE);
 await cache.put(SHELL_KEY,response.clone());
 // Delete superseded app-shell caches only AFTER successfully caching the new shell.
 const old=(await caches.keys()).filter(n=>n.startsWith(PREFIX)&&n!==SHELL_CACHE);
 await Promise.all(old.map(n=>caches.delete(n).catch(()=>false)));
}
function boundedNetwork(req){
 const ac=new AbortController();
 const timer=setTimeout(()=>ac.abort(),12000);
 return fetch(req,{cache:'no-store',signal:ac.signal}).finally(()=>clearTimeout(timer));
}
self.addEventListener('fetch',event=>{
 const req=event.request;
 if(req.method!=='GET')return;
 const url=new URL(req.url);
 if(url.origin!==APP_ROOT.origin)return;
 if(/\/(version\.json|sw\.js)$/i.test(url.pathname)){
  event.respondWith(fetch(req,{cache:'no-store'}));return;
 }
 if(!isShell(req,url))return;
 const forced=url.searchParams.has('cg_build')||url.searchParams.has('cg_cb')||url.searchParams.has('cg_recovered');
 event.respondWith((async()=>{
  // Explicit Update now MUST bypass cached HTML. Ordinary starts MUST NOT wait for 15MB download.
  if(!forced){
   const cached=await findStoredShell();
   if(cached)return cached;
  }
  try{
   const response=await boundedNetwork(req);
   if(isValidHtml(response)){
    event.waitUntil(storeShell(response.clone()).catch(()=>{}));
    return response;
   }
   return await findStoredShell()||response;
  }catch(err){
   return await findStoredShell()||new Response('Offline: Calibrated Golf is not yet cached.',{status:503,headers:{'Content-Type':'text/plain; charset=utf-8'}});
  }
 })());
});
self.addEventListener('message',event=>{
 if(!event.data||event.data.type!=='CACHE_CURRENT_PAGE'||warmInProgress)return;
 warmInProgress=true;
 const work=(async()=>{
  try{
   const own=await caches.open(SHELL_CACHE);
   if(await own.match(SHELL_KEY))return;
   // Do not download a second 15MB copy while the existing shell is available.
   if(await findStoredShell())return;
   const response=await boundedNetwork(SHELL_KEY);
   if(isValidHtml(response))await storeShell(response);
  }catch(_){}finally{warmInProgress=false;}
 })();
 if(typeof event.waitUntil==='function')event.waitUntil(work);
});
