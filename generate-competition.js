#!/usr/bin/env node
import { execSync } from "child_process";
import fs from "fs";
import "dotenv/config";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config();

async function generateObfuscatedData() {
  // Check if data.json exists
  if (!fs.existsSync("./data.json")) {
    console.error(
      "❌ data.json not found! Please run prep-data.js first to generate the original data."
    );
    process.exit(1);
  }

  // Generate a new obfuscation seed for this competition
  const competitionSeed = `COMP_${Date.now()}_${Math.random()
    .toString(36)
    .substr(2, 9)}`;
  process.env.OBFUSCATION_SEED = competitionSeed;

  try {
    // Run the obfuscation script
    execSync("node obfuscate-data.js", { stdio: "inherit" });
  } catch (error) {
    console.error("❌ Error generating competition data:", error.message);
    process.exit(1);
  }
  console.log("✅ Obfuscated data generated locally in competition-data.json!");

  // Add start timestamp
  const competitionData = JSON.parse(
    fs.readFileSync("competition-data.json", "utf8")
  );
  const startTime = Date.now();
  const updatedData = { data: competitionData, startTime };
  fs.writeFileSync(
    "competition-data.json",
    JSON.stringify(updatedData, null, 2)
  );

  await uploadFile();
}

async function uploadFile() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY) {
    console.log("ℹ️ Skipping Supabase upload (no SUPABASE_URL/SUPABASE_KEY set). Using local competition-data.json.");
    return;
  }

  try {
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_KEY
    );
    const fileBuffer = fs.readFileSync("competition-data.json");

    const { data, error } = await supabase.storage
      .from("data")
      .upload("competition-data.json", fileBuffer, {
        contentType: "application/json",
        upsert: true,
      });

    if (error) {
      console.warn(
        "⚠️ Supabase upload skipped/failed (local competition-data.json will be used instead):",
        error.message
      );
    } else {
      console.log("✅ File uploaded to Supabase successfully:", data);
    }
  } catch (err) {
    console.warn(
      "⚠️ Supabase unreachable (local competition-data.json will be used instead):",
      err.message
    );
  }
}

generateObfuscatedData();
