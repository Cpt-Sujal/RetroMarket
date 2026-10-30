import fs from "fs";
import { readFile } from "fs/promises";

// Read the original NSE historical data
let originalData;
try {
  originalData = JSON.parse(
    await readFile(new URL("./data.json", import.meta.url))
  );
} catch (e) {
  console.error("Failed to read data.json:", e);
  process.exit(1);
}

// 2 hours 20 minutes = 140 minutes = 8,400 seconds
// At 20 seconds per update -> 420 intervals -> 421 rounds (Round 0 at 0m to Round 420 at 140m)
const TOTAL_ROUNDS = 421;
const PEAK_ROUND_30M = 90; // 30 minutes = 90 rounds (90 * 20s = 1800s = 30m)

// Fixed competition seed so the organizer's verification table is 100% reproducible
const seed = "COMP_2H20M_FIXED_V1";

function seededRandom(seedStr) {
  let hash = 0;
  for (let i = 0; i < seedStr.length; i++) {
    const char = seedStr.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return () => {
    hash = (hash * 9301 + 49297) % 233280;
    return Math.abs(hash / 233280);
  };
}

const random = seededRandom(seed);

// Exact 10 display stocks requested by organizer (in order 1 to 10):
// 1= KOTAKBANK
// 2= WIPRO      (Up first 30m, then down-down only)
// 3= RUNIVERSE  (Swapped with NSE -> gets RVNL +136.88% breakout)
// 4= JIO        (Up first 30m, then down-down only)
// 5= AURAMETER  (WORST overall return)
// 6= ADANIPOWER
// 7= TMPV
// 8= TCS
// 9= L&T        (BEST overall return)
// 10= NSE       (Swapped with RUNIVERSE -> gets ZEEL +10.94% trajectory)
const stockConfigs = [
  {
    slot: 1,
    displayTicker: "KOTAKBANK",
    sourceIndex: 0, // RELIANCE: Dip early then steady recovery (+50.98%)
    startPrice: 620.0,
    mode: "normal",
    returnScale: 0.85,
  },
  {
    slot: 2,
    displayTicker: "WIPRO",
    sourceIndex: 3, // VEDL base volatility, shaped: UP first 30m (R0..R90), then DOWN only (R90..R420)
    startPrice: 480.0,
    mode: "up30m_then_down",
    upPeakMult: 1.28,
    endMult: 0.72,
  },
  {
    slot: 3,
    displayTicker: "NSE", // Will be swapped into slot 10 after RNG pass to preserve exact RNG sequence
    sourceIndex: 6, // ZEEL: Big early spike + two-way swings (+10.94% net)
    startPrice: 340.0,
    mode: "normal",
    returnScale: 0.9,
  },
  {
    slot: 4,
    displayTicker: "JIO",
    sourceIndex: 7, // BANDHANBNK base volatility, shaped: UP first 30m (R0..R90), then DOWN only (R90..R420)
    startPrice: 750.0,
    mode: "up30m_then_down",
    upPeakMult: 1.34,
    endMult: 0.66,
  },
  {
    slot: 5,
    displayTicker: "AURAMETER",
    sourceIndex: 4, // PAYTM: Heavy crash (-52.87% net -> WORST stock overall)
    startPrice: 890.0,
    mode: "worst",
    returnScale: 1.15,
  },
  {
    slot: 6,
    displayTicker: "ADANIPOWER",
    sourceIndex: 1, // ADANIENT: Huge rally up to 120m then sharp Hindenburg crash at 140m (+16.25% net)
    startPrice: 290.0,
    mode: "normal",
    returnScale: 1.0,
  },
  {
    slot: 7,
    displayTicker: "TMPV",
    sourceIndex: 9, // BHEL: Dip in first hour, late recovery (+4.36% net)
    startPrice: 410.0,
    mode: "normal",
    returnScale: 1.0,
  },
  {
    slot: 8,
    displayTicker: "TCS",
    sourceIndex: 8, // TATASTEEL: Solid cyclical uptrend (+103.25% net)
    startPrice: 1120.0,
    mode: "normal",
    returnScale: 0.55,
  },
  {
    slot: 9,
    displayTicker: "L&T",
    sourceIndex: 5, // HAL: Strongest bull run (+194.56% net -> BEST stock overall)
    startPrice: 540.0,
    mode: "best",
    returnScale: 1.02,
  },
  {
    slot: 10,
    displayTicker: "RUNIVERSE", // Will be swapped into slot 3 after RNG pass
    sourceIndex: 2, // RVNL: Strong breakout (+136.88% net, second best behind L&T)
    startPrice: 820.0,
    mode: "normal",
    returnScale: 0.52,
  },
];

// Build 421 rounds of price series for all 10 stocks
const rawSeries = stockConfigs.map((cfg) => {
  const prices = new Array(TOTAL_ROUNDS);
  prices[0] = cfg.startPrice;

  if (cfg.mode === "up30m_then_down") {
    const upStepDrift = Math.pow(cfg.upPeakMult, 1 / PEAK_ROUND_30M) - 1;
    const downRounds = TOTAL_ROUNDS - 1 - PEAK_ROUND_30M;
    const downTotalRatio = cfg.endMult / cfg.upPeakMult;
    const downStepDrift = Math.pow(downTotalRatio, 1 / downRounds) - 1;

    for (let i = 1; i < TOTAL_ROUNDS; i++) {
      const rawPct = originalData[i][cfg.sourceIndex].change / 100;
      const clampedFluctuation = Math.max(-0.012, Math.min(0.012, rawPct * 0.45));
      const drift = i <= PEAK_ROUND_30M ? upStepDrift : downStepDrift;
      const targetProgress =
        i <= PEAK_ROUND_30M
          ? cfg.startPrice * Math.pow(cfg.upPeakMult, i / PEAK_ROUND_30M)
          : cfg.startPrice *
            cfg.upPeakMult *
            Math.pow(downTotalRatio, (i - PEAK_ROUND_30M) / downRounds);

      const rawNext = prices[i - 1] * (1 + drift + clampedFluctuation);
      const nextPrice = 0.85 * rawNext + 0.15 * targetProgress;
      prices[i] = Math.max(1.0, Math.round(nextPrice * 100) / 100);
    }
  } else {
    for (let i = 1; i < TOTAL_ROUNDS; i++) {
      const rawPct = originalData[i][cfg.sourceIndex].change / 100;
      const scaledPct =
        rawPct * (cfg.returnScale ?? 1.0) + (random() - 0.5) * 0.0006;
      const nextPrice = prices[i - 1] * (1 + scaledPct);
      prices[i] = Math.max(1.0, Math.round(nextPrice * 100) / 100);
    }
  }

  return prices;
});

// Swap index 2 (Slot 3 = RUNIVERSE) and index 9 (Slot 10 = NSE) so:
// Slot 3 is RUNIVERSE (with RVNL +136.88% series) and Slot 10 is NSE (with ZEEL +10.94% series)
const orderedSlots = [0, 1, 9, 3, 4, 5, 6, 7, 8, 2];
const finalConfigs = orderedSlots.map((idx, slotIdx) => ({
  ...stockConfigs[idx],
  slot: slotIdx + 1,
}));
const seriesBySlot = orderedSlots.map((idx) => rawSeries[idx]);

// Format into round-by-round array for competition-data.json
const obfuscatedData = [];
for (let i = 0; i < TOTAL_ROUNDS; i++) {
  const row = [];
  for (let s = 0; s < finalConfigs.length; s++) {
    const close = seriesBySlot[s][i];
    const prevClose = i > 0 ? seriesBySlot[s][i - 1] : close;
    const change =
      i > 0
        ? ((close - prevClose) * 100) / prevClose
        : originalData[0][finalConfigs[s].sourceIndex].change * 0.5;

    row.push({
      ticker: finalConfigs[s].displayTicker,
      close: close,
      change: Math.round(change * 10000) / 10000,
    });
  }
  obfuscatedData.push(row);
}

const tickerMapping = {};
finalConfigs.forEach((cfg) => {
  const origTicker = originalData[0][cfg.sourceIndex].ticker;
  tickerMapping[cfg.displayTicker] = origTicker;
});

const mapping = {
  seed,
  totalRounds: TOTAL_ROUNDS,
  durationMinutes: 140,
  roundDurationSeconds: 20,
  displayOrder: finalConfigs.map((c) => `${c.slot}=${c.displayTicker}`),
  displayToHiddenMapping: tickerMapping,
  generatedAt: new Date().toISOString(),
};

fs.writeFileSync(
  "competition-data.json",
  JSON.stringify(obfuscatedData, null, 2)
);
fs.writeFileSync("mapping.json", JSON.stringify(mapping, null, 2));
