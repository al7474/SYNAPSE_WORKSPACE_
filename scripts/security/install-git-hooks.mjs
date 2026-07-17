#!/usr/bin/env node

import { execSync } from "node:child_process";

function main() {
  execSync("git config core.hooksPath .githooks", { stdio: "inherit" });
  console.log("Git hooks installed. core.hooksPath=.githooks");
}

main();
