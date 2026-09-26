KEDCO FRONTEND LOCAL STORAGE

The application entry point is index.html. The local storage configuration is loaded by supabase-config.js for compatibility with existing page includes. It sets the local backend address and clears obsolete remote connection settings without touching local sessions or operational records.

assets/supabase.js is a local KEDCO data client. It provides the existing page interface while sending authentication, local table, file, and version-poll requests only to the KEDCO backend.

kedco-auth.js handles local sign-in and role routing. kedco-global-ui.js manages shared local browser state and snapshots. kedco-cloud-backup.js handles local evidence and archive files through the local adapter.

Application data is stored under ../cloud data/. Browser preferences, drafts, and the local login session remain in browser local storage.
