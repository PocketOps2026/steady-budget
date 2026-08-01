# Harbor — a due-date-first budget

*(This project's folder and GitHub repo are still named `steady-budget` — only the app's name and look changed. Renaming the repo itself is optional; see the bottom of this file if you want to do that too.)*

Most budget apps make you review a log of past transactions. Harbor flips
that: it's built around what's coming up. Add your income and bills once,
and it shows a due-date timeline, a real calendar laid out month by month
(including weekly and biweekly bills like child support), and instant
plain-language feedback — plus a "paying off" tracker with a small
celebration when a debt finally hits zero.

Everything runs client-side and saves to your browser's local storage. There's
no account, no bank linking, and no database, and no AI calls — all the
feedback is rule-based and instant.

## Layout

The app is organized into 5 tabs: **Today** (stats, next-paycheck window,
what's due, feedback — the one you'll open most), **Calendar** (the month-by-
month view), **Income & Bills** (entry forms and the income coverage card),
**Debt & Goals** (debt strategy, paying off, paid off, saving for), and
**Trends** (category breakdown and month-over-month history). Your last-used
tab is remembered, and Print always outputs all of them regardless of which
tab is open.

## Power features (no AI involved — all rule-based)

- **Before your next paycheck.** Add a pay day to a fixed income source (a
  day of the month, a weekday, or two paydays for semimonthly pay) and a new
  card shows everything due before that paycheck lands, how much is
  arriving, and whether it covers it. Skip the pay-date fields and this card
  just prompts you to add one — nothing breaks.
- **Saving for.** A savings-goal tracker separate from debt payoff, for
  irregular costs you can see coming (car registration, holiday gifts,
  annual premiums). Set a target amount and month, log contributions as you
  make them, and it tells you the pace needed to hit the goal on time.
- **Trend.** Once you've used the app across more than one calendar month,
  a chart appears showing income/bills/leftover for each recent month, plus
  a feedback line comparing this month to last.
- **Debt strategy.** Add an optional interest rate when marking a bill as
  debt. With 2+ debts, a new card ranks which one to throw extra money at
  first (highest rate first — mathematically saves the most) and estimates
  monthly interest cost and payoff time per debt. No rates entered yet? It
  falls back to smallest-balance-first and tells you as much.

## More power features (still no AI — all rule-based)

- **Bill price tracking.** Click "Update price" next to any bill to log a
  new amount when it changes. If a bill jumps 8%+ since the last time you
  logged it, feedback flags it — catches quiet cost creep (utilities,
  insurance, subscriptions) before it compounds.
- **Print view.** The Print button in the top bar gives a clean, paper-
  friendly summary — all the interactive controls are hidden automatically
  for printing.
- **Essential vs. Flexible.** Tag each bill as Essential or Flexible when
  adding it. When the budget's tight, feedback points specifically at your
  flexible spending instead of just your biggest category (which is often
  rent — not something you can cut).
- **Income coverage.** With 2+ income sources, tag which one pays for each
  bill ("Paid from" on the bill form). A new card shows how much of each
  paycheck is allocated vs. left over, and flags anything unassigned.

## Variable / commission income

Not every income source is a predictable paycheck. When adding an income
source, choose **Variable / commission** instead of Fixed, and log actual
amounts as they come in (one entry per month). The app then computes:

- the average of your last (up to) 6 logged months, and
- the lowest of those months.

By default it budgets off the **lowest recent month** — the standard advice
for commission-based income is to budget against a bad month, not an average
one, so a slow month doesn't leave you short. You can switch a source to
"average" instead from its basis dropdown, but the app will flag that as
riskier if your income swings a lot. Any month can be edited by re-logging
the same month with a new amount, or removed with the × next to it.

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

## Notes on data

- Data lives in `localStorage`, per browser/device — there's no shared
  account, so opening the site on a second device starts blank.
- To keep two people in sync: whoever last updated the budget clicks
  **Export** to download a backup JSON, sends it over (text, email, AirDrop,
  whatever's easiest), and the other person clicks **Import** on their
  device to load it in. It's manual, but there's no risk of two people
  editing different copies without knowing it, as long as you get in the
  habit of exporting after you make changes.
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
