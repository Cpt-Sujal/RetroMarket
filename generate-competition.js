#!/usr/bin/env node
import { execSync } from "child_process";
import fs from "fs";

async function generateObfuscatedData() {
  if (!fs.existsSync("./data.json")) {
    console.error(
      "❌ data.json not found! Please run prep-data.js first to generate the original data."
    );
    process.exit(1);
  }

  try {
    execSync("node obfuscate-data.js", { stdio: "inherit" });
  } catch (error) {
    console.error("❌ Error generating competition data:", error.message);
    process.exit(1);
  }

  const competitionData = JSON.parse(
    fs.readFileSync("competition-data.json", "utf8")
  );
  const startTime = Date.now();
  const updatedData = { data: competitionData, startTime };
  fs.writeFileSync(
    "competition-data.json",
    JSON.stringify(updatedData, null, 2)
  );
  console.log("✅ Obfuscated data generated locally in competition-data.json!");
}

generateObfuscatedData();
