# Harbor — a due-date-first budget

*(This project's folder and GitHub repo are still named `steady-budget` — only the app's name and look changed. Renaming the repo itself is optional; see the bottom of this file if you want to do that too.)*

Most budget apps make you review a log of past transactions. Harbor flips
that: it's built around what's coming up. Add your income and bills once,
and it shows a due-date timeline, a real calendar laid out month by month
(including weekly and biweekly bills like child support), instant
plain-language feedback, and optional AI-generated advice — plus a "paying
off" tracker with a small celebration when a debt finally hits zero.

Everything runs client-side and saves to your browser's local storage. There's
no account, no bank linking, and no database. The only server-side piece is a
single optional API route that adds AI-generated advice on top of the built-in
rule-based feedback.

## What's new in this version

- **New name and look** — renamed from Steady to Harbor, with a warm color
  palette, an anchor logo, and small animations (numbers count up, progress
  bars fill smoothly, cards ease in).
- **Weekly and biweekly bills** — bills aren't limited to "once a month on day
  X" anymore. Add a bill as Weekly (e.g. child support every Friday) or Every
  2 weeks (with a start date), and it recurs correctly.
- **Month-by-month calendar** — a real calendar grid under "Month by month."
  Use the ‹ › arrows to look up to a year ahead. Each day shows every bill due
  that day; click a bill on the calendar to mark it paid. The summary above
  the calendar totals exactly what's due that specific month (so a month with
  5 Fridays instead of 4 shows correctly) alongside income and leftover.

Your existing data is untouched — it's keyed the same way in local storage,
so nothing was lost in this update.

## Run it locally

No build step needed — it's plain HTML/CSS/JS. From this folder:

```
npx serve .
```

Then open the URL it prints (something like `http://localhost:3000`).

## Push the update to GitHub

```
cd steady-budget
git add .
git commit -m "Redesign: rename to Harbor, add calendar and weekly/biweekly bills"
git push
```

(No need to re-run `git init` or `git remote add` — that's already set up from
the first push.)

Vercel will auto-deploy the update within about a minute of the push.

## Turning on AI advice (optional)

The "Get personalized advice" button calls `/api/advice`, a Vercel serverless
function. Without an API key it gracefully says the feature isn't set up yet
and the rest of the app works fine.

To enable it:

1. Get an API key from [console.anthropic.com](https://console.anthropic.com).
2. In your Vercel project: Settings → Environment Variables → add
   `ANTHROPIC_API_KEY` with that key.
3. Redeploy (Vercel → Deployments → ⋯ → Redeploy).

## Notes on data

- Data lives in `localStorage`, per browser. If you and your wife use
  different devices, use the **Export** button to download a backup JSON and
  **Import** it on the other device to keep them in sync.
- Marking a "paying off" bill as paid each cycle automatically reduces its
  balance by the payment amount. You can also manually correct a balance
  (e.g. after an extra payment) from the "Paying off" section.
- When a balance hits zero, it moves to a "🎉 Paid off" section, its monthly
  payment stops counting against your budget, and you get a small confetti
  moment.

## Customizing

- Categories are a fixed list in `index.html` (`<select id="billCategory">`) —
  edit that list to add/remove categories.
- Colors and spacing live in `style.css` as CSS variables at the top of the
  file (`--good`, `--warn`, `--bad`, `--accent`, etc.).
- All the budgeting logic (due-date math, recurrence, feedback rules, payoff
  tracking) is in `app.js`, and is intentionally simple/readable if you want
  to tweak the rules yourself.

## Renaming the actual GitHub repo (optional)

If you'd like the repo/URL to say "harbor" instead of "steady-budget" too:
GitHub → your repo → Settings → repository name → rename. Vercel picks up
the rename automatically on the next push; your live URL may change unless
you set a custom domain.
