# KEDCO Local Storage Edition — Start Here

Storage mode: **LOCAL**  
Data folder: `cloud data/`  
Login directory: `LOGIN_DETAILS_PRIVATE.csv`

## Start
From the project root:

```powershell
powershell.exe -ExecutionPolicy Bypass -File ".\Start-KEDCO-Local.ps1"
```

Or manually:

```powershell
cd .\backend
npm.cmd run dev
```

Open `http://localhost:3000/`.

All 48 approved login emails are already created. Change the temporary passwords before production.
