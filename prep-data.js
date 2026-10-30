import "dotenv/config";
import fs from "fs";
import csv from "csvtojson";

// 3 hours @ 20s per update = 540 intervals -> 541 rounds (Round 0 to Round 540)
const TARGET_ROUNDS = 541;

function parseDateDDMMYYYY(str) {
  const [dd, mm, yyyy] = str.split("-").map(Number);
  return Math.floor(Date.UTC(yyyy, mm - 1, dd) / 1000);
}

// dd-mm-yyyy
const fetch_close = async (ticker, from, to) => {
  try {
    if (process.env.NSE_COOKIE) {
      const requestOpts = {
        method: "GET",
        headers: {
          Cookie: process.env.NSE_COOKIE || "",
          "User-Agent": "Mozilla/5.0",
        },
      };
      const res = await fetch(
        `https://www.nseindia.com/api/historical/cm/equity?symbol=${ticker}&series=["EQ"]&from=${from}&to=${to}&csv=true`,
        requestOpts
      );
      if (res.ok) {
        const text = await res.text();
        const data = await csv().fromString(text);
        const uniqueData = [];
        for (const d of data) {
          if (!uniqueData.find((ud) => ud["Date "] === d["Date "])) {
            uniqueData.push(d);
          }
        }
        if (uniqueData.length >= TARGET_ROUNDS + 1) {
          return uniqueData
            .map((d) => parseFloat(d["close "].replace(/,/g, "")))
            .reverse();
        }
      }
    }
  } catch (err) {
    // Fallback to Yahoo Finance NSE historical API below
  }

  const period1 = parseDateDDMMYYYY(from);
  const period2 = parseDateDDMMYYYY(to);
  const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    ticker
  )}.NS?period1=${period1}&period2=${period2}&interval=1d`;
  const res = await fetch(yahooUrl);
  if (!res.ok) {
    throw new Error(
      `Failed to fetch data for ${ticker}. Status: ${res.status}`
    );
  }
  const json = await res.json();
  const closes =
    json?.chart?.result?.[0]?.indicators?.quote?.[0]?.close?.filter(
      (c) => typeof c === "number" && !Number.isNaN(c)
    ) || [];
  if (closes.length === 0) {
    throw new Error(`No close data returned for ${ticker}`);
  }
  return closes.map((c) => Math.round(c * 100) / 100);
};

const main = async () => {
  // 10 real NSE stocks over ~2.4-year windows (>= 542 trading days) chosen for high volatility:
  // Mix of Covid crash + recovery, Adani surge + Hindenburg crash, Railway/PSU rallies, Metal cycles, and Paytm/ZEEL crashes
  const tickers = [
    {
      name: "RELIANCE",
      from: "01-01-2020",
      to: "01-06-2022", // Covid crash (-41%) -> massive Jio rally (+220%) -> consolidation
    },
    {
      name: "ADANIENT",
      from: "01-06-2021",
      to: "01-11-2023", // Huge bull run (+194%) -> Hindenburg crash (-71%) -> sharp bounce
    },
    {
      name: "RVNL",
      from: "01-01-2022",
      to: "01-06-2024", // Consolidation -> multi-bagger railway breakout with sharp 15-20% pullbacks
    },
    {
      name: "VEDL",
      from: "01-06-2021",
      to: "01-11-2023", // Commodity boom up to peak -> sharp cyclical downturn & bear market
    },
    {
      name: "PAYTM",
      from: "01-12-2021",
      to: "01-05-2024", // Post-IPO crash (-75%) -> strong relief rally (+160%) -> RBI ban crash
    },
    {
      name: "HAL",
      from: "01-01-2021",
      to: "01-06-2023", // Steady defense uptrend with volatile swings
    },
    {
      name: "ZEEL",
      from: "01-09-2021",
      to: "01-03-2024", // Sony merger spike (+90%) -> choppy swings -> merger collapse crash (-55%)
    },
    {
      name: "BANDHANBNK",
      from: "01-01-2021",
      to: "01-06-2023", // Two-way volatile banking swings (-35% drops & +45% rallies, net downward)
    },
    {
      name: "TATASTEEL",
      from: "01-03-2020",
      to: "01-08-2022", // Metal supercycle rally -> sharp correction
    },
    {
      name: "BHEL",
      from: "01-06-2021",
      to: "01-11-2023", // Sideways traps + drop (-35%) -> strong PSU turnaround rally
    },
  ];

  const data = {};
  for (const ticker of tickers) {
    const close = await fetch_close(ticker.name, ticker.from, ticker.to);
    data[ticker.name] = close;
    console.log(`Fetched ${ticker.name}: ${close.length} trading days`);
  }

  let minLen = Infinity;
  let stock = "";
  for (const ticker in data) {
    minLen = Math.min(minLen, data[ticker].length);
    if (data[ticker].length === minLen) {
      stock = ticker;
    }
  }
  console.log("Stock with min length:", stock, "Min length:", minLen);

  const totalRounds = Math.min(TARGET_ROUNDS, minLen - 1);
  const aggregatedData = [];
  for (let i = 1; i <= totalRounds; i++) {
    const row = [];
    for (const ticker in data) {
      row.push({
        ticker,
        close: data[ticker][i],
        change:
          ((data[ticker][i] - data[ticker][i - 1]) * 100) / data[ticker][i - 1],
      });
    }
    aggregatedData.push(row);
  }

  fs.writeFileSync("data.json", JSON.stringify(aggregatedData));
  console.log(
    `✅ Generated data.json with ${aggregatedData.length} rounds (${
      (aggregatedData.length - 1) * 20 / 60
    } minutes @ 20s/round) for 10 stocks.`
  );
};

main();
