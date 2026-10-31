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
// 1= KOTAKBANK   (Price multiplied by 5x across all rounds: 3100 -> 4680.40)
// 2= ZOMATO      (Up first 30m, then down-down only)
// 3= RUNIVERSE   (Swapped -> gets RVNL +136.88% breakout)
// 4= JIO         (Up first 30m, then down-down only)
// 5= OLA         (Up -> Down -> Up -> Down & Down, ending -49.90% loss!)
// 6= SUZLON      (125 -> ~200 -> ~320 -> ~220 -> ~250 -> ~60 -> ~110)
// 7= NYKAA       (Swapped with TCS -> gets TATASTEEL +103.25% cyclical rally)
// 8= TCS         (Swapped with NYKAA -> gets BHEL 15x price: 6150 -> 6418.20)
// 9= L&T         (BEST overall return: +398.40% up!)
// 10= SUNPHARMA  (Swapped -> gets ZEEL +10.94% trajectory)
const stockConfigs = [
  {
    slot: 1,
    displayTicker: "KOTAKBANK",
    sourceIndex: 0, // RELIANCE: Dip early then steady recovery (+50.98%), multiplied by 5x
    startPrice: 620.0,
    priceMultiplier: 5,
    mode: "normal",
    returnScale: 0.85,
  },
  {
    slot: 2,
    displayTicker: "ZOMATO",
    sourceIndex: 3, // VEDL base volatility, shaped: UP first 30m (R0..R90), then DOWN only (R90..R420)
    startPrice: 480.0,
    priceMultiplier: 1,
    mode: "up30m_then_down",
    upPeakMult: 1.28,
    endMult: 0.72,
  },
  {
    slot: 3,
    displayTicker: "SUNPHARMA", // Swapped into slot 10 after RNG pass to preserve exact RNG sequence
    sourceIndex: 6, // ZEEL: Big early spike + two-way swings (+10.94% net)
    startPrice: 340.0,
    priceMultiplier: 1,
    mode: "normal",
    returnScale: 0.9,
  },
  {
    slot: 4,
    displayTicker: "JIO",
    sourceIndex: 7, // BANDHANBNK base volatility, shaped: UP first 30m (R0..R90), then DOWN only (R90..R420)
    startPrice: 750.0,
    priceMultiplier: 1,
    mode: "up30m_then_down",
    upPeakMult: 1.34,
    endMult: 0.66,
  },
  {
    slot: 5,
    displayTicker: "SUZLON",
    sourceIndex: 4, // PAYTM base volatility, shaped to organizer's exact milestones:
    // 0m: 125 -> 20m: ~200 -> 40m: ~320 -> 60m: ~220 -> 70m: ~250 -> down & down to ~60 at 120m -> last 20m close ~110 at 140m
    startPrice: 125.0,
    priceMultiplier: 1,
    mode: "multi_wave",
    waypoints: [
      { round: 0, mult: 1.0 },      // 0m:   125.00
      { round: 60, mult: 1.60 },    // 20m: ~200.00
      { round: 120, mult: 2.56 },   // 40m: ~320.00
      { round: 180, mult: 1.76 },   // 60m: ~220.00
      { round: 210, mult: 2.00 },   // 70m: ~250.00
      { round: 240, mult: 1.56 },   // 80m: ~195.00 (down)
      { round: 300, mult: 0.92 },   // 100m: ~115.00 (down)
      { round: 360, mult: 0.48 },   // 120m: ~60.00 (down near 60rs)
      { round: 420, mult: 0.88 },   // 140m: ~110.00 (last 20m close near 110rs)
    ],
  },
  {
    slot: 6,
    displayTicker: "OLA",
    sourceIndex: 1, // ADANIENT base volatility, shaped: UP (0-30m) -> DOWN (30-60m) -> UP (60-100m) -> DOWN & DOWN (100-140m to -50%)
    startPrice: 290.0,
    priceMultiplier: 1,
    mode: "multi_wave",
    waypoints: [
      { round: 0, mult: 1.0 },     // 0m:   290.00
      { round: 90, mult: 1.36 },   // 30m: ~394.40 (First UP)
      { round: 180, mult: 0.81 },  // 60m: ~234.90 (Then DOWN)
      { round: 300, mult: 1.22 },  // 100m: ~353.80 (Again UP)
      { round: 360, mult: 0.76 },  // 120m: ~220.40 (Then DOWN...)
      { round: 420, mult: 0.50 },  // 140m: ~145.00 (...and DOWN to -50%!)
    ],
  },
  {
    slot: 7,
    displayTicker: "TCS", // Swapped into slot 8 after RNG pass
    sourceIndex: 9, // BHEL: Dip in first hour, late recovery (+4.36% net), multiplied by 15x
    startPrice: 410.0,
    priceMultiplier: 15,
    mode: "normal",
    returnScale: 1.0,
  },
  {
    slot: 8,
    displayTicker: "NYKAA", // Swapped into slot 7 after RNG pass
    sourceIndex: 8, // TATASTEEL: Solid cyclical uptrend (+103.25% net)
    startPrice: 1120.0,
    priceMultiplier: 1,
    mode: "normal",
    returnScale: 0.55,
  },
  {
    slot: 9,
    displayTicker: "L&T",
    sourceIndex: 5, // HAL: Strongest bull run (+398.40% net -> BEST stock overall)
    startPrice: 540.0,
    priceMultiplier: 1,
    mode: "best",
    returnScale: 1.595,
  },
  {
    slot: 10,
    displayTicker: "RUNIVERSE", // Swapped into slot 3 after RNG pass
    sourceIndex: 2, // RVNL: Strong breakout (+136.88% net, second best behind L&T)
    startPrice: 820.0,
    priceMultiplier: 1,
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
  } else if (cfg.mode === "multi_wave") {
    // Consume random() once per round so subsequent normal stocks keep the exact same RNG state!
    const wps = cfg.waypoints;
    for (let i = 1; i < TOTAL_ROUNDS; i++) {
      random(); // preserve RNG sequence for stocks 7, 8, 9, 10
      let seg = wps.length - 2;
      for (let w = 0; w < wps.length - 1; w++) {
        if (i >= wps[w].round && i <= wps[w + 1].round) {
          seg = w;
          break;
        }
      }
      const wStart = wps[seg];
      const wEnd = wps[seg + 1];
      const segRounds = wEnd.round - wStart.round;
      const segProgress = (i - wStart.round) / segRounds;
      const segRatio = wEnd.mult / wStart.mult;
      const stepDrift = Math.pow(segRatio, 1 / segRounds) - 1;

      const rawPct = originalData[i][cfg.sourceIndex].change / 100;
      const clampedFluctuation = Math.max(-0.014, Math.min(0.014, rawPct * 0.45));
      const targetPrice =
        cfg.startPrice * wStart.mult * Math.pow(segRatio, segProgress);

      const rawNext = prices[i - 1] * (1 + stepDrift + clampedFluctuation);
      const nextPrice = 0.82 * rawNext + 0.18 * targetPrice;
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

  // Apply display multiplier (e.g. 5x for KOTAKBANK, 15x for TCS) across every round
  const mult = cfg.priceMultiplier || 1;
  if (mult !== 1) {
    for (let i = 0; i < TOTAL_ROUNDS; i++) {
      prices[i] = Math.round(prices[i] * mult * 100) / 100;
    }
  }

  return prices;
});

// Slot ordering after swaps:
// - Slot 3 (RUNIVERSE) <-> Slot 10 (SUNPHARMA)
// - Slot 5 (OLA)       <-> Slot 6 (ADANIPOWER)
// - Slot 7 (NYKAA)     <-> Slot 8 (TCS)
const orderedSlots = [0, 1, 9, 3, 5, 4, 7, 6, 8, 2];
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
