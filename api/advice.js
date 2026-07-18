// Vercel serverless function (Node runtime).
// Calls Anthropic's API to turn a budget summary into short, personalized advice.
// Requires an ANTHROPIC_API_KEY environment variable set in your Vercel project settings.
// If it's not set, this returns { advice: null, error: "not_configured" } and the
// app falls back to showing only the instant rule-based feedback.

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(200).json({ advice: null, error: "not_configured" });
    return;
  }

  const summary = req.body && req.body.summary;
  if (!summary) {
    res.status(400).json({ advice: null, error: "missing_summary" });
    return;
  }

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 300,
        system:
          "You are a warm, practical budgeting coach for a couple who recently took a significant pay cut and are budgeting carefully as a result. Given a JSON summary of their monthly income, bills, leftover cash, category totals, upcoming due dates, debts they're actively paying off, and anything recently paid off, write 3-4 short sentences of specific, non-judgmental, encouraging advice. If something was recently paid off, briefly celebrate it. If a debt is close to being paid off, mention it. Reference their actual numbers where useful. No generic platitudes, no bullet points, plain prose.",
        messages: [
          { role: "user", content: JSON.stringify(summary) },
        ],
      }),
    });

    if (!response.ok) {
      res.status(200).json({ advice: null, error: "upstream_error" });
      return;
    }

    const data = await response.json();
    const text = data?.content?.[0]?.text ?? null;
    res.status(200).json({ advice: text });
  } catch (err) {
    res.status(200).json({ advice: null, error: "request_failed" });
  }
}
