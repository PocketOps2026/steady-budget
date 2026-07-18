# Steady — a due-date-first budget

Most budget apps make you review a log of past transactions. Steady flips that:
it's built around what's coming up. Add your income and bills once, and it
shows a due-date timeline, instant plain-language feedback, and optional
AI-generated advice — plus a "paying off" tracker with a small celebration
when a debt finally hits zero.

Everything runs client-side and saves to your browser's local storage. There's
no account, no bank linking, and no database. The only server-side piece is a
single optional API route that adds AI-generated advice on top of the built-in
rule-based feedback.

## Run it locally

No build step needed — it's plain HTML/CSS/JS. From this folder:

```
npx serve .
```

Then open the URL it prints (something like `http://localhost:3000`).

## Put it on GitHub

```
cd steady-budget
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/<your-username>/steady-budget.git
git push -u origin main
```

(Create the empty `steady-budget` repo on GitHub first, without a README, so
there's no merge conflict on push.)

## Deploy on Vercel

1. Go to vercel.com and "Add New… → Project".
2. Import the `steady-budget` GitHub repo.
3. Framework preset: "Other" (no build command needed).
4. Deploy.

That's it for the core app. Every push to `main` will auto-deploy.

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
- All the budgeting logic (due-date math, feedback rules, payoff tracking) is
  in `app.js`, and is intentionally simple/readable if you want to tweak the
  rules yourself.
