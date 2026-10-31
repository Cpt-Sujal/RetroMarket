import express from "express";
import cors from "cors";
import "dotenv/config";
import dotenv from "dotenv";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { readFile } from "fs/promises";
import { createClient } from "@supabase/supabase-js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = Number(process.env.PORT) || 3000;
const MAX_CONNECTIONS = Number(process.env.MAX_CONNECTIONS) || 100;
const ADMIN_PIN = process.env.ADMIN_PIN || "1234";

// Global competition dataset & live controller state
let competitionData = [];
const stateFilePath = path.join(__dirname, "competition-state.json");

const controller = {
  isRunning: false, // Starts PAUSED at Round 0 until organizer clicks Start in /admin
  baseRound: 0, // Round index when last started/paused/jumped
  lastResumedAt: null, // Timestamp (ms) when 'start' was clicked
  roundDurationMs: Number(process.env.ROUND_DURATION_MS) || 20000,
};

function loadSavedControllerState() {
  try {
    if (fs.existsSync(stateFilePath)) {
      const saved = JSON.parse(fs.readFileSync(stateFilePath, "utf8"));
      if (typeof saved.isRunning === "boolean") controller.isRunning = saved.isRunning;
      if (typeof saved.baseRound === "number") controller.baseRound = saved.baseRound;
      if (saved.lastResumedAt) controller.lastResumedAt = saved.lastResumedAt;
      if (typeof saved.roundDurationMs === "number") controller.roundDurationMs = saved.roundDurationMs;
    }
  } catch (e) {
    console.warn("Could not load competition-state.json:", e.message);
  }
}

function saveControllerState() {
  try {
    fs.writeFileSync(stateFilePath, JSON.stringify(controller, null, 2));
  } catch (e) {
    // Ignore read-only filesystem errors on serverless platforms
  }
}

function getCurrentRoundInfo() {
  const total = competitionData.length || 421;
  const maxRound = Math.max(0, total - 1);

  if (!controller.isRunning || !controller.lastResumedAt) {
    const clamped = Math.max(0, Math.min(maxRound, controller.baseRound));
    return {
      index: clamped,
      maxRound,
      msUntilNextRound: controller.roundDurationMs,
    };
  }

  const elapsed = Math.max(0, Date.now() - controller.lastResumedAt);
  const addedRounds = Math.floor(elapsed / controller.roundDurationMs);
  const currentRound = controller.baseRound + addedRounds;

  if (currentRound >= maxRound) {
    // Reached the end of the competition (Round 420 / 140m) -> Hold at final round!
    controller.isRunning = false;
    controller.baseRound = maxRound;
    controller.lastResumedAt = null;
    saveControllerState();
    return {
      index: maxRound,
      maxRound,
      msUntilNextRound: 0,
    };
  }

  const msIntoCurrentRound = elapsed % controller.roundDurationMs;
  return {
    index: currentRound,
    maxRound,
    msUntilNextRound: controller.roundDurationMs - msIntoCurrentRound,
  };
}

function buildPayload(connectionsCount = 0) {
  const { index, maxRound, msUntilNextRound } = getCurrentRoundInfo();
  if (!Array.isArray(competitionData) || competitionData.length === 0) {
    return {
      index: 0,
      maxRound: 0,
      isRunning: controller.isRunning,
      roundDurationMs: controller.roundDurationMs,
      msUntilNextRound: 0,
      connectedClients: connectionsCount,
      stockData: [],
    };
  }

  const startHistIdx = Math.max(0, index - 80);
  const stockData = competitionData[index].map((stock, sIdx) => {
    const history = [];
    for (let r = startHistIdx; r <= index; r++) {
      history.push(competitionData[r][sIdx].close);
    }
    return {
      ...stock,
      startPrice: competitionData[0][sIdx].close,
      history,
    };
  });

  return {
    index,
    maxRound,
    isRunning: controller.isRunning,
    roundDurationMs: controller.roundDurationMs,
    msUntilNextRound,
    connectedClients: connectionsCount,
    stockData,
  };
}

function setupApp(__dirname, MAX_CONNECTIONS) {
  const connections = [];
  const app = express();

  app.use(cors());
  app.use(express.json());

  app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "static/index.html"));
  });

  app.get("/admin", (req, res) => {
    res.status(404).send("Cannot GET /admin");
  });

  app.get("/fuck", (req, res) => {
    res.sendFile(path.join(__dirname, "static/admin.html"));
  });

  app.post("/api/admin/verify", (req, res) => {
    const { pin } = req.body || {};
    const configuredPin = process.env.ADMIN_PIN || ADMIN_PIN;
    if (String(pin) === String(configuredPin)) {
      return res.json({ success: true });
    }
    return res.status(401).json({ success: false, error: "Invalid 4-digit Admin PIN" });
  });

  app.get("/api/state", (req, res) => {
    res.set("Cache-Control", "no-store");
    res.json(buildPayload(connections.length));
  });

  app.post("/api/admin", (req, res) => {
    const { pin, action, round, roundDurationMs } = req.body || {};
    const configuredPin = process.env.ADMIN_PIN || ADMIN_PIN;
    if (String(pin) !== String(configuredPin)) {
      return res.status(401).json({ error: "Invalid Admin PIN" });
    }

    const { index: currentIndex, maxRound } = getCurrentRoundInfo();

    if (action === "start") {
      if (!controller.isRunning) {
        if (currentIndex >= maxRound) {
          controller.baseRound = 0;
        } else {
          controller.baseRound = currentIndex;
        }
        controller.lastResumedAt = Date.now();
        controller.isRunning = true;
      }
    } else if (action === "pause") {
      controller.baseRound = currentIndex;
      controller.isRunning = false;
      controller.lastResumedAt = null;
    } else if (action === "reset") {
      controller.baseRound = 0;
      controller.isRunning = false;
      controller.lastResumedAt = null;
    } else if (action === "jump") {
      const target = Math.max(0, Math.min(maxRound, Number(round) || 0));
      controller.baseRound = target;
      if (controller.isRunning) {
        controller.lastResumedAt = Date.now();
      }
    } else if (action === "speed") {
      const newMs = Math.max(1000, Number(roundDurationMs) || 20000);
      controller.baseRound = currentIndex;
      controller.roundDurationMs = newMs;
      if (controller.isRunning) {
        controller.lastResumedAt = Date.now();
      }
    } else {
      return res.status(400).json({ error: "Unknown action" });
    }

    saveControllerState();
    const payload = buildPayload(connections.length);
    const out = JSON.stringify(payload);
    connections.forEach((clientRes) => {
      try {
        clientRes.write(`data: ${out}\n\n`);
      } catch (e) {}
    });

    return res.json(payload);
  });

  app.get("/stock-stream", (req, res) => {
    if (connections.length >= MAX_CONNECTIONS) {
      res.status(503).end();
      return;
    }

    res.set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.flushHeaders?.();
    res.write(": OK\n\n");

    // Immediately push current state to newly connected screen
    const initialOut = JSON.stringify(buildPayload(connections.length + 1));
    res.write(`data: ${initialOut}\n\n`);

    connections.push(res);

    req.on("close", () => {
      const idx = connections.indexOf(res);
      if (idx !== -1) connections.splice(idx, 1);
      try {
        res.end();
      } catch (e) {}
    });
  });

  return { app, connections };
}

const { app, connections } = setupApp(__dirname, MAX_CONNECTIONS);

export default app;

function parseCompetitionContent(fileContent) {
  const parsed = JSON.parse(fileContent);
  if (parsed && parsed.data) {
    return { data: parsed.data, startTime: parsed.startTime };
  }
  return { data: parsed, startTime: null };
}

async function loadData() {
  const localCompPath = path.join(__dirname, "competition-data.json");
  const localDataPath = path.join(__dirname, "data.json");

  if (fs.existsSync(localCompPath)) {
    try {
      const fileContent = await readFile(localCompPath, "utf8");
      return parseCompetitionContent(fileContent);
    } catch (err) {
      console.error("Error reading local competition-data.json:", err.message);
    }
  }

  if (process.env.SUPABASE_URL && process.env.SUPABASE_KEY) {
    try {
      const supabase = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_KEY
      );
      const { data: uploadedFile, error } = await supabase?.storage
        ?.from("data")
        .download("competition-data.json");
      if (!error && uploadedFile) {
        const fileContent = await uploadedFile.text();
        return parseCompetitionContent(fileContent);
      }
    } catch (err) {}
  }

  if (fs.existsSync(localDataPath)) {
    try {
      const fileContent = await readFile(localDataPath, "utf8");
      return parseCompetitionContent(fileContent);
    } catch (err) {}
  }

  return { data: [], startTime: null };
}

async function startStreaming(connections) {
  const intervalInSec = 1;
  const sendStockData = () => {
    if (connections.length === 0) return;
    try {
      const payload = buildPayload(connections.length);
      const out = JSON.stringify(payload);
      connections.forEach((res) => {
        try {
          res.write(`data: ${out}\n\n`);
        } catch (e) {}
      });
    } catch (err) {
      console.error("Error while preparing/sending stock data:", err.message);
    }
  };

  sendStockData();
  return setInterval(sendStockData, intervalInSec * 1000);
}

async function main() {
  dotenv.config();
  loadSavedControllerState();

  const { data } = await loadData();
  competitionData = Array.isArray(data) ? data : [];
  console.log(`Loaded ${competitionData.length} competition rounds.`);

  await startStreaming(connections);

  if (!process.env.VERCEL) {
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`✅ Live Screen:  http://localhost:${PORT}`);
      console.log(`🛠️  Admin Panel:  http://localhost:${PORT}/fuck (PIN configured in .env)`);
    });
  }
}

main();
