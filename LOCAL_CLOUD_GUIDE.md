# KEDCO local storage

KEDCO uses the local Express backend and the cloud data folder for application records, workflow data, uploads, and snapshots. Browser-only preferences and drafts remain in browser local storage.

## Start and restart

From the project folder, run:

    powershell.exe -ExecutionPolicy Bypass -File ".\Start-KEDCO-Local.ps1"
    powershell.exe -ExecutionPolicy Bypass -File ".\Restart-KEDCO-Local.ps1"

Open http://localhost:3000. The backend health endpoint is http://localhost:3000/health and reports storage_mode: local.

## Where data lives

- cloud data/tables/: local JSON records
- cloud data/uploads/: uploaded evidence and source files
- cloud data/system/: backend logs and process state
- Browser local storage: local session, preferences, drafts, and cached page data

The local browser adapter routes authentication, table, file, and sync operations to this backend. Legacy page code still uses a compatible client interface, but it has no hosted database endpoint or remote credentials. Existing local records and login sessions are kept when local-only configuration is loaded.
