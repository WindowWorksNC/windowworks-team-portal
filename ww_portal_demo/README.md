# Window Works Team Portal - Training Demo

This is a self contained training and demo copy of the Window Works Team Portal. It looks and behaves like the live portal, but it runs entirely in the browser with fictional people and fictional data. There is no live Google Sheet, no Apps Script proxy, and no Pipedrive connection. Nothing you do here can touch real company data.

Use it to record walkthrough videos and to train the team without exposing anything real.

## What is different from the live portal

The live portal talks to a Google Apps Script proxy and to Pipedrive. This demo replaces both with an in memory mock backend defined in `mock-api.js`:

- Every page loads `mock-api.js` before `gate.js`. It defines the same `api()` function the pages expect, so the UI and all the `cols()` conventions are unchanged.
- Reads return seeded dummy data. Appends, updates, and deletes all report success and change the data in memory only.
- All changes reset the moment you reload the page. There is no persistence.
- Any call that would have hit Pipedrive is intercepted and answered with fictional won deals, so the sales B2B tracker still populates.
- The real proxy URL and the real Pipedrive token have been removed from every page.

## The cast (all fictional)

| Person | Role | Page | PIN |
| --- | --- | --- | --- |
| Olivia Owner | Co-Owner | olivia.html | 1111 |
| Owen Owner | Co-Owner | owen.html | 2222 |
| Able Admin | Admin / Payroll | able.html | 3333 |
| Wally Windowsalesguy | Sales (commission and B2B bounties) | wally.html | 4444 |
| Polly Projectmanager | Project Manager | polly.html | 5555 |

Either owner PIN (1111 or 2222) unlocks any dashboard, the same way the live portal lets the owners roam. Each employee PIN unlocks only that person's page.

Wally has both the B2C commission features and the B2B booking and partner bounty features, so a single sales page can demo the full sales picture. Able's "Consistent Performance" scorecard domain is intentionally left unset so you can demo an owner setting it live.

The seeded commissions, bounties, and booking bonuses are generated against the current pay period and the current quarter at load time, so the current period panels stay populated no matter what day you record.

## Run it locally

Any static file server works. From this folder:

```
python3 -m http.server 8000
```

Then open http://localhost:8000/ in your browser and pick a person from the landing page.

You can also just open `index.html` directly, but serving over http is more faithful to how it runs in production.

## Put it in your existing portal as a quiet, separate folder

This whole folder drops into your existing `windowworks-team-portal` repo as its own subfolder, so it never touches or overwrites the live portal.

1. Open your `windowworks-team-portal` repo on GitHub.
2. Click "Add file", then "Upload files".
3. Drag this entire `ww_portal_demo` folder into the upload area. GitHub keeps the folder, so all the demo files land together inside it.
4. Commit. Within a minute the demo is live at:
   `https://windowworksnc.github.io/windowworks-team-portal/ww_portal_demo/`

That address is separate from your real portal and is not linked from anywhere. Every page also carries a "noindex" tag, so search engines skip it and it will not show up in Google. And the PIN gate still applies. Nobody gets to it unless you hand them the link and a PIN.

Because everything is fake and in memory, there is no key and no real data to leak even in the worst case.

## Files

- `index.html` - landing page with the five demo people
- `olivia.html`, `owen.html` - co-owner dashboards
- `able.html` - admin and payroll dashboard
- `wally.html` - sales dashboard with commission and B2B bounties
- `polly.html` - project manager dashboard
- `mock-api.js` - the in memory mock backend and seeded dummy data
- `gate.js` - the PIN gate, pointed at the two demo owners
- `taskboard.js`, `resources.js`, `resources.html`, `portal.css` - shared UI, unchanged from the live portal

## Resetting the data

Reload any page. The mock backend rebuilds its seeded data from scratch on every load.
