import "dotenv/config";

const BANK_BASE_URL = process.env.BANK_BASE_URL!;
const BANK_USERNAME = process.env.BANK_USERNAME!;
const BANK_PASSWORD = process.env.BANK_PASSWORD!;

export interface BankTransaction {
  JrNo: string;
  JrItemNo: string;
  AcntNo: string;
  CurCode: string;
  TxnType: string;
  Amount: number;
  Rate: number;
  Balance: number;
  TxnDate: string;
  SysDate: string;
  TxnDesc: string;
  ContAcntNo: string;
  ContAcntName: string;
  ContBankCode: string;
  Location: string;
  BranchNo: string;
  Corr: string;
}

let cachedToken: string | null = null;
let tokenExpiry: Date | null = null;

async function getToken(): Promise<string> {
  if (cachedToken && tokenExpiry && new Date() < tokenExpiry) {
    return cachedToken;
  }

  console.log("[bank] Fetching new token...");
  const res = await fetch(`${BANK_BASE_URL}/api/v1/Token/GetToken`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: BANK_USERNAME, password: BANK_PASSWORD }),
  });

  if (!res.ok) throw new Error(`Token fetch failed: HTTP ${res.status}`);

  const data = await res.json();
  const token: string = data.accessToken;

  const expiry = new Date(data.expireDate.replace(/\//g, "-"));
  expiry.setMinutes(expiry.getMinutes() - 5);
  cachedToken = token;
  tokenExpiry = expiry;

  console.log(`[bank] Token acquired, expires at ${tokenExpiry.toISOString()}`);
  return token;
}

export async function fetchStatements(
  acntNo: string,
  startDate: string,
  endDate: string
): Promise<BankTransaction[]> {
  const token = await getToken();

  const res = await fetch(`${BANK_BASE_URL}/api/v1/Statement/Statements`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: token,
    },
    body: JSON.stringify({ acntNo, startDate, endDate, reList: [] }),
  });

  if (res.status === 204) return [];

  if (res.status === 401) {
    console.log("[bank] Token expired (401), refreshing...");
    cachedToken = null;
    tokenExpiry = null;
    return fetchStatements(acntNo, startDate, endDate);
  }

  if (!res.ok) throw new Error(`Statement fetch failed: HTTP ${res.status}`);

  return res.json();
}
