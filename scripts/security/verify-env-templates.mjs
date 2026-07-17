#!/usr/bin/env node

import { execSync } from "node:child_process";

const allowed = new Set([".env.example", "backend/.env.example", "frontend/.env.example"]);

function getTrackedEnvFiles() {
  const output = execSync("git ls-files", { encoding: "utf8" }).trim();
  const files = output ? output.split(/\r?\n/).filter(Boolean) : [];

  return files.filter((filePath) => {
    if (!filePath.includes(".env")) {
      return false;
    }

    const name = filePath.split("/").pop() || "";
    return name.startsWith(".env");
  });
}

function main() {
  const trackedEnvFiles = getTrackedEnvFiles();
  const violations = trackedEnvFiles.filter((filePath) => !allowed.has(filePath));

  if (violations.length > 0) {
    console.error("Only env templates can be tracked. Remove these files from git:\n");
    for (const filePath of violations) {
      console.error(`- ${filePath}`);
    }
    console.error("\nAllowed files:");
    for (const filePath of allowed) {
      console.error(`- ${filePath}`);
    }
    process.exit(1);
  }

  console.log("Env template check passed. Only .env.example templates are tracked.");
}

main();
