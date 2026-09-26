/* Executive page uses the local storage adapter. */
window.KEDCO_LOCAL_MODE = true;
window.KEDCO_STORAGE_MODE = "local";
window.KEDCO_LOCAL_CONFIG = window.KEDCO_LOCAL_CONFIG || {apiBase: (location.protocol === "file:" || ["5500","5501","5502"].includes(location.port)) ? `http://${location.hostname || "localhost"}:3000` : location.origin, storageMode: "local"};
window.KEDCO_SUPABASE_CONFIG = window.KEDCO_SUPABASE_CONFIG || {
  url: "http://localhost:3000",
  anonKey: "kedco-local-mode",
  apiBase: (location.protocol === "file:" || ["5500","5501","5502"].includes(location.port)) ? "http://localhost:3000" : "",
  storageMode: "local"
};
window.kedcoSupabase = window.supabase?.createClient?.(window.KEDCO_SUPABASE_CONFIG.url, window.KEDCO_SUPABASE_CONFIG.anonKey) || null;
