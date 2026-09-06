# Spin & Dine

A privacy-first, phone-first family restaurant picker PWA. All data stays in the browser's IndexedDB; there are no accounts, APIs, analytics, or external requests.

## Run locally

```powershell
cd "C:\Users\cgarr\Documents\ChatGPT\Spin & Dine"
node .\dev-server.js
```

Open http://localhost:5500 in Chrome. To test the PWA offline behavior, load it once while the server is running, then use Chrome's install option or add it to an iPhone Home Screen.

## Data

Settings contains JSON backup and restore. Restore validates the backup before it replaces local data.

Version: v1-001
