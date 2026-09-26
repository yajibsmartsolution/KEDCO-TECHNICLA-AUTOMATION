/* ============================================================
   KEDCO TECHNICAL AUTOMATION
   Shared Supabase Browser Client

   IMPORTANT:
   Browser code must use ONLY the public/anon/publishable key.
   NEVER place a service-role key in this file.
   ============================================================ */

(function () {

  "use strict";

  function getConfig() {
    const configured = window.KEDCO_LOCAL_CONFIG || window.KEDCO_SUPABASE_CONFIG || {};
    return { url: configured.apiBase || configured.url || "", anonKey: "kedco-local-mode" };
  }

  function createKedcoSupabaseClient() {
    if (!window.supabase?.createClient) throw new Error("KEDCO local data client is not loaded.");
    return window.supabase.createClient();
  }

  window.KEDCO_SUPABASE = { getConfig, createClient: createKedcoSupabaseClient };

})();
