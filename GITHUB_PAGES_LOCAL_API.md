# GitHub Pages demo with local KEDCO data

GitHub Pages hosts only the static website. The Express API and `cloud data/` remain on the Windows computer. Cloudflare Tunnel gives that computer a public HTTPS route; this is not an API hosted by GitHub.

## Publish the static site

In the GitHub repository, configure Pages to publish the `main` branch from the repository root. The site URL is `https://yajibsmartsolution.github.io/KEDCO_TECHNICAL_AUTOMATION/`.

## Start the local API and tunnel

Install Node.js and Cloudflare Tunnel (`cloudflared`) on the Windows computer that owns the KEDCO data. Stop any already-running local backend, then run:

```powershell
.\Start-KEDCO-GitHub-Demo.ps1
```

Keep the PowerShell window open and the computer online. Copy the `https://....trycloudflare.com` address printed by Cloudflare. In `frontend/supabase-config.js`, replace the empty `GITHUB_PAGES_API_BASE` value with that HTTPS address, without a trailing slash. Commit and push the change and wait for GitHub Pages to publish.

The Quick Tunnel URL is temporary. If it changes after restarting the tunnel, update `GITHUB_PAGES_API_BASE` and push the new value. Keep the tunnel process running throughout the presentation.

## Check connectivity

Open the tunnel's `/health` URL, for example `https://....trycloudflare.com/health`. It should return `ok: true` and `storage_mode: "local"`. Then open the GitHub Pages URL and sign in with an account in this computer's local user database.

## Data and security

Application records and uploads stay on this computer under the Git-ignored `cloud data/` directory. They are not backed up to GitHub. Do not commit `cloud data/`, `.env` files, credential CSVs, or the ignored trial-user roster. A public tunnel makes the local API internet-accessible; use sanitized demo data, rotate the previously shared temporary password, and stop the tunnel when the trial ends. This is a presentation setup, not production hosting or backup.