# Local trial account import

The trial account list is stored locally in the ignored `tools/kedco-trial-users.json`. It contains account names, work emails, roles, and expected landing pages only; it contains no passwords. Keep this personnel roster out of the public GitHub repository. `cloud data/` is also ignored because it contains runtime user, session, audit, and operational data.

## Before importing

The local backend must already have an initialized administrator whose login works. This importer does not bypass authentication.

## Import accounts

From PowerShell in the project folder, run:

```powershell
.\tools\Import-KEDCO-TrialUsers.ps1 -ApiBase "http://127.0.0.1:3000" -ResetExistingPasswords
```

The script requests administrator credentials securely, then creates missing accounts, synchronizes the listed roles, and activates listed accounts. Accounts not in the 48-entry manifest are left unchanged. `-ResetExistingPasswords` generates a distinct random password for every account in the list, including existing accounts. The passwords are written to a CSV under your Documents folder, outside the repository. The CSV is also covered by `.gitignore`; do not commit or share it publicly. Give each password only to its account holder through a private channel.

Without `-ResetExistingPasswords`, existing account passwords are left unchanged; only newly created accounts receive generated passwords and appear in the CSV. The importer never uses the shared temporary password from the pasted register.

The app currently does not force a password change at first sign-in. The generated passwords remain valid until an administrator changes them. The register's landing page is informational; the app selects dashboards from account roles. The Data Analyst account is routed to the register's MIS landing page.

Accounts and records stay in `cloud data/` on this computer, not on GitHub Pages. Keep a separate protected backup of that folder. Use `-ResetExistingPasswords` only when you intend to issue a new credential sheet.