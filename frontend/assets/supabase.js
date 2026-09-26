/* KEDCO local data client.
   Keeps legacy page interfaces working while sending every auth, table, file,
   and realtime request to the local backend and cloud data/ folder. */
(function(global){
  'use strict';
  if (global.supabase && global.supabase.__KEDCO_LOCAL_ADAPTER__) return;

  const listeners = new Set();
  const SESSION_KEY = 'KEDCO_AUTH_SESSION_V1';
  const LOCAL_SB_KEY = 'sb-localhost-auth-token';
  let refreshInFlight = null;

  function readAuthStorage(key){
    try { const value=sessionStorage.getItem(key); if(value!==null)return value; } catch {}
    try { return localStorage.getItem(key); } catch { return null; }
  }
  function writeAuthStorage(key,value){
    try { localStorage.setItem(key,value); try { sessionStorage.removeItem(key); } catch {} return true; } catch {}
    try { sessionStorage.setItem(key,value); return true; } catch { return false; }
  }
  function removeAuthStorage(key){
    try { localStorage.removeItem(key); } catch {}
    try { sessionStorage.removeItem(key); } catch {}
  }

  function apiBase(){
    const configured = String(global.KEDCO_LOCAL_CONFIG?.apiBase || global.KEDCO_SUPABASE_CONFIG?.apiBase || localStorage.getItem('KEDCO_API_BASE') || '').trim();
    const currentHost = String(location.hostname || '').toLowerCase();
    const isLocalHost = value => value === 'localhost' || value === '::1' || value === '[::1]' || /^127(?:\.\d{1,3}){3}$/.test(value) || /^10(?:\.\d{1,3}){3}$/.test(value) || /^192\.168(?:\.\d{1,3}){2}$/.test(value) || /^172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}$/.test(value) || value.endsWith('.local') || (!!value && !value.includes('.'));
    const host = isLocalHost(currentHost) ? currentHost : 'localhost';
    const fallback = isLocalHost(currentHost)
      ? (location.port === '3000' ? location.origin : `http://${host}:3000`)
      : location.origin;
    try {
      const target = new URL(configured || fallback, location.href);
      if (!['http:', 'https:'].includes(target.protocol)) return fallback;
      // Accept the configured host if it's a local/LAN address or the exact
      // same origin as this page (e.g. a public deployment serving both
      // the frontend and API from one host, such as Render).
      if (!isLocalHost(target.hostname.toLowerCase()) && target.hostname.toLowerCase() !== currentHost) return fallback;
      return target.origin.replace(/\/$/, '');
    } catch { return fallback; }
  }

  function readSession(){
    try { const v = JSON.parse(readAuthStorage(SESSION_KEY) || 'null'); return v?.session || v || null; } catch { return null; }
  }
  function writeSession(session){
    try {
      if(session) {
        const serialized=JSON.stringify(session);
        writeAuthStorage(SESSION_KEY,serialized);
        writeAuthStorage(LOCAL_SB_KEY,serialized);
      } else {
        removeAuthStorage(SESSION_KEY);
        removeAuthStorage(LOCAL_SB_KEY);
      }
    } catch {}
  }
  function token(){ return readSession()?.access_token || ''; }
  function notifyAuthChange(event,session){ for(const cb of listeners)try{cb(event,session)}catch{} }
  function err(message, status){ const e = new Error(message); e.status = status || 500; return e; }
  async function fetchWithTimeout(url, options={}, timeoutMs=8000){
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try { return await fetch(url, {...options, signal:controller.signal}); }
    catch (error) {
      if (error?.name === 'AbortError') throw err(`Local KEDCO request timed out after ${Math.round(timeoutMs/1000)} seconds`, 504);
      throw error;
    } finally { clearTimeout(timer); }
  }
  async function refreshLocalSession(failedToken,expectedRefreshToken){
    const current=readSession();
    if(!current?.refresh_token||!expectedRefreshToken||current.refresh_token!==expectedRefreshToken)return false;
    if(current.access_token&&current.access_token!==failedToken)return true;
    if(refreshInFlight)return refreshInFlight;
    refreshInFlight=(async()=>{
      let response;
      try{
        response=await fetchWithTimeout(apiBase()+"/api/auth/refresh",{
          method:"POST",
          headers:{"content-type":"application/json"},
          body:JSON.stringify({refresh_token:current.refresh_token})
        });
      }catch{return false;}
      if(!response.ok){
        if(response.status===401||response.status===403){
          const latest=readSession();
          if(latest?.access_token===current.access_token&&latest?.refresh_token===current.refresh_token){writeSession(null);notifyAuthChange('SIGNED_OUT',null);}
        }
        return false;
      }
      let body;
      try{body=await response.json()}catch{return false;}
      const next=body?.session;
      if(!next?.access_token)return false;
      const latest=readSession();
      if(!latest||latest.refresh_token!==current.refresh_token)return false;
      if(latest.access_token!==current.access_token)return Boolean(latest.access_token);
      writeSession(next);
      notifyAuthChange("TOKEN_REFRESHED",next);
      return true;
    })();
    try{return await refreshInFlight;}finally{refreshInFlight=null;}
  }
  async function jsonFetch(path, options={}){
    const headers = new Headers(options.headers || {});
    if (!headers.has('content-type') && options.body && !(options.body instanceof Blob) && !(options.body instanceof ArrayBuffer)) headers.set('content-type','application/json');
    const session=readSession(),t=session?.access_token||''; if (t && !headers.has('authorization')) headers.set('authorization', 'Bearer ' + t);
    const requestToken=String(headers.get('authorization')||'').replace(/^Bearer\s+/i,'').trim();
    const requestRefreshToken=requestToken===session?.access_token?session?.refresh_token:'';
    const canRefresh=Boolean(requestToken.startsWith('kedco_local_')&&requestRefreshToken)&&!/^\/api\/auth\/(?:login|refresh|setup)(?:\?|$)/i.test(path);
    let res;
    try { res = await fetchWithTimeout(`${apiBase()}${path}`, {...options, headers}); }
    catch (e) { throw err(`Local KEDCO backend is unreachable: ${e?.message || e}`, 503); }
    if(res.status===401&&canRefresh&&await refreshLocalSession(requestToken,requestRefreshToken)){
      headers.set('authorization','Bearer '+token());
      try { res = await fetchWithTimeout(apiBase()+path, {...options, headers}); }
      catch (e) { throw err('Local KEDCO backend is unreachable: '+(e?.message||e), 503); }
    }
    const text = await res.text(); let body = {};
    try { body = text ? JSON.parse(text) : {}; } catch { body = { message:text }; }
    if (!res.ok) throw err(body.error || body.message || `Local backend request failed (${res.status})`, res.status);
    return body;
  }
  async function binaryFetch(path, file, headers={}){
    const h = new Headers(headers); const session=readSession(),t=session?.access_token||''; if(t)h.set('authorization','Bearer '+t); h.set('content-type','application/octet-stream');
    let res = await fetchWithTimeout(apiBase()+path, {method:'POST',headers:h,body:file}, 30000);
    if(res.status===401&&t.startsWith('kedco_local_')&&await refreshLocalSession(t,session?.refresh_token)){
      h.set('authorization','Bearer '+token());
      res=await fetchWithTimeout(apiBase()+path, {method:'POST',headers:h,body:file}, 30000);
    }
    const text = await res.text(); let body={}; try{body=text?JSON.parse(text):{}}catch{body={message:text}};
    if(!res.ok) throw err(body.error||body.message||`Local file upload failed (${res.status})`,res.status); return body;
  }
  function result(promise){ return promise.then(data=>({data,error:null})).catch(error=>({data:null,error})); }

  class QueryBuilder {
    constructor(table){ this.table=table; this.action='select'; this.payload=null; this.filters=[]; this.orderBy=null; this.offset=0; this.rowLimit=1000; this.returnSelection=false; this.singleMode=''; }
    select(_columns='*'){ if(this.action==='select')this.action='select'; else this.returnSelection=true; return this; }
    insert(value){ this.action='insert'; this.payload=value; return this; }
    update(value){ this.action='update'; this.payload=value||{}; return this; }
    delete(){ this.action='delete'; return this; }
    eq(column,value){ this.filters.push({op:'eq',column,value}); return this; }
    neq(column,value){ this.filters.push({op:'neq',column,value}); return this; }
    gte(column,value){ this.filters.push({op:'gte',column,value}); return this; }
    gt(column,value){ this.filters.push({op:'gt',column,value}); return this; }
    lte(column,value){ this.filters.push({op:'lte',column,value}); return this; }
    lt(column,value){ this.filters.push({op:'lt',column,value}); return this; }
    is(column,value){ this.filters.push({op:'is',column,value}); return this; }
    in(column,value){ this.filters.push({op:'in',column,value}); return this; }
    order(column,opts={}){ this.orderBy={column,ascending:opts.ascending!==false}; return this; }
    range(from,to){ this.offset=Math.max(0,Number(from)||0); this.rowLimit=Math.max(0,(Number(to)||0)-this.offset+1); return this; }
    limit(n){ this.rowLimit=Math.max(0,Number(n)||0); return this; }
    single(){ this.singleMode='single'; return this.execute(); }
    maybeSingle(){ this.singleMode='maybe'; return this.execute(); }
    async execute(){
      try {
        let data;
        if(this.action==='select'){
          const qs=new URLSearchParams({filters:JSON.stringify(this.filters),offset:String(this.offset),limit:String(this.rowLimit)}); if(this.orderBy)qs.set('order',JSON.stringify(this.orderBy));
          data=(await jsonFetch(`/api/local/tables/${encodeURIComponent(this.table)}?${qs}`)).data||[];
        } else if(this.action==='insert'){
          data=(await jsonFetch(`/api/local/tables/${encodeURIComponent(this.table)}`,{method:'POST',body:JSON.stringify(this.payload)})).data||[];
        } else if(this.action==='update'){
          data=(await jsonFetch(`/api/local/tables/${encodeURIComponent(this.table)}`,{method:'PATCH',body:JSON.stringify({patch:this.payload,filters:this.filters})})).data||[];
        } else {
          const qs=new URLSearchParams({filters:JSON.stringify(this.filters)});
          data=(await jsonFetch(`/api/local/tables/${encodeURIComponent(this.table)}?${qs}`,{method:'DELETE'})).data||[];
        }
        if(this.singleMode==='single'){
          if(!Array.isArray(data)||data.length!==1) return {data:null,error:err(`Expected one row, received ${Array.isArray(data)?data.length:0}`,406)};
          return {data:data[0],error:null};
        }
        if(this.singleMode==='maybe') return {data:Array.isArray(data)?(data[0]||null):null,error:null};
        return {data,error:null};
      } catch(error){ return {data:null,error}; }
    }
    then(resolve,reject){ return this.execute().then(resolve,reject); }
    catch(reject){ return this.execute().catch(reject); }
  }

  function storageBucket(bucket){
    return {
      upload: async(path,file,opts={}) => result(binaryFetch(`/api/local/files/upload?bucket=${encodeURIComponent(bucket)}&path=${encodeURIComponent(path)}&upsert=${opts.upsert?'true':'false'}`, file)),
      remove: async(paths) => result(jsonFetch('/api/local/files',{method:'DELETE',body:JSON.stringify({bucket,paths})}).then(x=>x.data||[])),
      createSignedUrl: async(path,_expiresIn=900,options) => {
        try {
          const t=token(); if(!t) throw err('Local KEDCO session is missing',401);
          const qs=new URLSearchParams({bucket,path,token:t}); if(options?.download)qs.set('download','1');
          return {data:{signedUrl:`${apiBase()}/api/local/files/download?${qs}`},error:null};
        } catch(error){ return {data:null,error}; }
      }
    };
  }

  const localChannels = new Set();
  let versionPollTimer = null;
  let versionPollInFlight = false;
  let sharedVersion = -1;

  function notifyLocalVersion(version){
    for (const channel of localChannels) {
      if (channel.version < 0) { channel.version = version; continue; }
      if (channel.version === version) continue;
      channel.version = version;
      for (const handler of channel.handlers) try { handler({eventType:'UPDATE',new:{},old:{}}); } catch {}
    }
  }

  async function pollLocalVersion(){
    if (versionPollInFlight || !localChannels.size) return;
    versionPollInFlight = true;
    try {
      const response = await fetchWithTimeout(`${apiBase()}/api/local/version`, {cache:'no-store'}, 3000);
      if (!response.ok) return;
      const body = await response.json();
      const version = Number(body.version || 0);
      if (sharedVersion < 0) sharedVersion = version;
      else if (version !== sharedVersion) { sharedVersion = version; notifyLocalVersion(version); }
    } catch {}
    finally { versionPollInFlight = false; }
  }

  function startVersionPolling(){
    if (versionPollTimer) return;
    versionPollTimer = setInterval(() => void pollLocalVersion(), 1500);
    void pollLocalVersion();
  }

  function stopVersionPolling(){
    if (localChannels.size || !versionPollTimer) return;
    clearInterval(versionPollTimer);
    versionPollTimer = null;
    sharedVersion = -1;
  }

  class LocalChannel {
    constructor(name){ this.name=name; this.handlers=[]; this.version=-1; }
    on(_type,_filter,callback){ if(typeof callback==='function')this.handlers.push(callback); return this; }
    subscribe(callback){
      if(typeof callback==='function') setTimeout(()=>callback('SUBSCRIBED'),0);
      localChannels.add(this);
      if (sharedVersion >= 0) this.version = sharedVersion;
      startVersionPolling();
      return this;
    }
    unsubscribe(){ localChannels.delete(this); stopVersionPolling(); return Promise.resolve('ok'); }
  }

  function createClient(){
    const channels=new Set();
    const auth={
      getSession: async()=>({data:{session:readSession()},error:null}),
      getUser: async()=>{ try{const body=await jsonFetch('/api/auth/me'); return {data:{user:{...body.user,user_metadata:{full_name:body.user?.full_name},app_metadata:{roles:body.roles,primary_role:body.role}}},error:null};}catch(error){return {data:{user:null},error};}},
      setSession: async(tokens)=>{ try{ writeSession({...readSession(),...tokens}); const body=await jsonFetch('/api/auth/me'); const session={...readSession(),user:{id:body.user.id,email:body.user.email,user_metadata:{full_name:body.user.full_name},app_metadata:{roles:body.roles,primary_role:body.role}}}; writeSession(session); for(const cb of listeners)try{cb('SIGNED_IN',session)}catch{}; return {data:{session,user:session.user},error:null}; }catch(error){return {data:{session:null,user:null},error};}},
      signInWithPassword: async(credentials)=>{ try{const body=await jsonFetch('/api/auth/login',{method:'POST',body:JSON.stringify(credentials)}); writeSession(body.session); for(const cb of listeners)try{cb('SIGNED_IN',body.session)}catch{}; return {data:{session:body.session,user:body.session.user},error:null};}catch(error){return {data:{session:null,user:null},error};}},
      refreshSession: async(args={})=>{ try{const refresh_token=args.refresh_token||readSession()?.refresh_token; const body=await jsonFetch('/api/auth/refresh',{method:'POST',body:JSON.stringify({refresh_token})}); writeSession(body.session); notifyAuthChange('TOKEN_REFRESHED',body.session); return {data:{session:body.session,user:body.session.user},error:null};}catch(error){return {data:{session:null,user:null},error};}},
      signOut: async()=>{ try{if(token())await jsonFetch('/api/auth/logout',{method:'POST',body:'{}'});}catch{} writeSession(null); for(const cb of listeners)try{cb('SIGNED_OUT',null)}catch{}; return {error:null};},
      onAuthStateChange: (callback)=>{listeners.add(callback); setTimeout(()=>{try{callback('INITIAL_SESSION',readSession())}catch{}},0); return {data:{subscription:{unsubscribe(){listeners.delete(callback)}}}};}
    };
    const client={
      __KEDCO_LOCAL_CLIENT__:true,
      from:(table)=>new QueryBuilder(table),
      rpc:async(name,args={})=>{ try{const body=await jsonFetch(`/api/local/rpc/${encodeURIComponent(name)}`,{method:'POST',body:JSON.stringify(args)}); return {data:body.data,error:null};}catch(error){return {data:null,error};}},
      storage:{from:storageBucket}, auth,
      channel:(name)=>{const c=new LocalChannel(name);channels.add(c);return c;},
      removeChannel:async(c)=>{channels.delete(c);return c?.unsubscribe?.()||'ok';},
      removeAllChannels:async()=>{for(const c of channels)await c.unsubscribe();channels.clear();return 'ok';},
      getChannels:()=>[...channels]
    };
    return client;
  }

  global.supabase={__KEDCO_LOCAL_ADAPTER__:true,createClient};
})(window);
