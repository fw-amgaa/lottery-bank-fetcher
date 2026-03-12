import "dotenv/config";
import express from "express";
import { fetchStatements, BankTransaction } from "./bank";
import { readState, writeState } from "./state";

const app = express();
app.use(express.json());
const PORT = process.env.PORT || 4000;
const BANK_ACCOUNT_NO = process.env.BANK_ACCOUNT_NO!;
const NEXTJS_CALLBACK_URL = process.env.NEXTJS_CALLBACK_URL!;
const CALLBACK_SECRET = process.env.CALLBACK_SECRET!;
const SMS_API_KEY = process.env.SMS_API_KEY!;

// Called by cron-jobs.org every minute
app.get("/fetch", async (req, res) => {
  const now = new Date();
  const state = readState();

  // Use date of last fetch as startDate, fallback to yesterday
  const startDate = state.lastFetchedAt
    ? toDateString(new Date(state.lastFetchedAt))
    : toDateString(new Date(Date.now() - 86400 * 1000));
  const endDate = toDateString(now);

  console.log(`[fetch] Fetching statements from ${startDate} to ${endDate}`);

  let transactions: BankTransaction[];
  try {
    transactions = await fetchStatements(BANK_ACCOUNT_NO, startDate, endDate);
  } catch (err) {
    console.error("[fetch] Bank API error:", err);
    return res.status(502).json({ success: false, error: String(err) });
  }

  // Filter to only new transactions (after lastFetchedAt) and only incoming (credit)
  const newTransactions = transactions.filter((t) => {
    const isNew = state.lastFetchedAt
      ? new Date(t.TxnDate) > new Date(state.lastFetchedAt)
      : true;
    // TxnType "C" = credit (incoming). Filter out debits.
    const isCredit = t.TxnType === "C" || t.Amount > 0;
    return isNew && isCredit;
  });

  console.log(
    `[fetch] Found ${transactions.length} total, ${newTransactions.length} new`
  );

  if (newTransactions.length === 0) {
    writeState({ lastFetchedAt: now.toISOString() });
    return res.json({ success: true, processed: 0 });
  }

  // Send to Next.js callback
  try {
    const callbackRes = await fetch(
      `${NEXTJS_CALLBACK_URL}/api/bank/transactions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": CALLBACK_SECRET,
        },
        body: JSON.stringify({ transactions: newTransactions }),
      }
    );

    if (!callbackRes.ok) {
      const body = await callbackRes.text();
      throw new Error(`Callback returned HTTP ${callbackRes.status}: ${body}`);
    }

    const result = await callbackRes.json();
    console.log(`[fetch] Callback success:`, result);
  } catch (err) {
    console.error("[fetch] Callback error:", err);
    // Don't update lastFetchedAt so we retry next minute
    return res.status(502).json({ success: false, error: String(err) });
  }

  // Only update state after successful callback
  writeState({ lastFetchedAt: now.toISOString() });
  return res.json({ success: true, processed: newTransactions.length });
});

// SMS tunnel — Next.js calls this since EC2 IP is whitelisted with Unitel
app.post("/sms", async (req, res) => {
  const apiKey = req.headers["x-api-key"];
  if (apiKey !== CALLBACK_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { to, message } = req.body;
  if (!to || !message) {
    return res.status(400).json({ error: "Missing to or message" });
  }

  try {
    const smsRes = await fetch(
      `https://pn.unitel.mn/api/message/send/sms?enc=${SMS_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to, message }),
      }
    );
    const data = await smsRes.text();
    console.log(`[sms] to=${to} status=${smsRes.status} response=${data}`);
    return res.status(smsRes.ok ? 200 : 502).json({ ok: smsRes.ok, response: data });
  } catch (err) {
    console.error("[sms] Error:", err);
    return res.status(500).json({ error: String(err) });
  }
});

app.get("/health", (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`[server] lottery-bank-fetcher running on port ${PORT}`);
});

function toDateString(date: Date): string {
  return date.toISOString().split("T")[0];
}
