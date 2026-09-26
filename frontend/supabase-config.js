/* KEDCO local storage configuration. */
(function (window) {
  const hostname = String(window.location.hostname || '').toLowerCase();
  const isLocalHost = value => value === 'localhost' || value === '::1' || value === '[::1]' || /^127(?:\.\d{1,3}){3}$/.test(value) || /^10(?:\.\d{1,3}){3}$/.test(value) || /^192\.168(?:\.\d{1,3}){2}$/.test(value) || /^172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}$/.test(value) || value.endsWith('.local') || (!!value && !value.includes('.'));
  // On a machine/LAN host, talk to the backend on its dedicated port 3000.
  // On a public deployment (e.g. Render), the same service serves both the
  // frontend and the API, so same-origin (no port override) is correct.
  const apiBase = isLocalHost(hostname)
    ? (window.location.port === '3000' ? window.location.origin : `http://${hostname}:3000`)
    : window.location.origin;
  const config = Object.freeze({ apiBase, storageMode: 'local' });
  window.KEDCO_LOCAL_MODE = true;
  window.KEDCO_STORAGE_MODE = 'local';
  window.KEDCO_LOCAL_CONFIG = config;
  // Legacy pages still request this config name; it points only to the local backend.
  window.KEDCO_SUPABASE_CONFIG = Object.freeze({
    url: apiBase,
    anonKey: 'kedco-local-mode',
    apiBase,
    storageMode: 'local'
  });
  try {
    localStorage.setItem('KEDCO_API_BASE', apiBase);
    localStorage.removeItem('KEDCO_SUPABASE_URL');
    localStorage.removeItem('KEDCO_SUPABASE_ANON_KEY');
    localStorage.removeItem('KEDCO_TRANS_SUPABASE_V1');
    for (const key of ['yajib-feeder-analyzer-v1', 'KEDCO_TMO_INTELLIGENCE_HUB_V2']) {
      try {
        const state = JSON.parse(localStorage.getItem(key) || 'null');
        if (state?.settings?.onlineDb) {
          delete state.settings.onlineDb.url;
          delete state.settings.onlineDb.key;
          localStorage.setItem(key, JSON.stringify(state));
        }
        if (state?.onlineDb) {
          delete state.onlineDb.url;
          delete state.onlineDb.key;
          localStorage.setItem(key, JSON.stringify(state));
        }
      } catch (_) {}
    }
  } catch (_) {}
})(window);
