import { spawnSync } from "node:child_process";

const CONTAINER_NAME = "synapse-pgvector-test";
const DB_NAME = "synapse_test";
const HOST_PORT = 55432;
const IMAGE = "pgvector/pgvector:pg18";
const DATABASE_URL = `postgresql://postgres@127.0.0.1:${HOST_PORT}/${DB_NAME}`;

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    ...options,
  });

  if (result.status !== 0) {
    throw new Error(`Command failed: ${command} ${args.join(" ")}`);
  }
}

function runCommandAllowFailure(command, args, options = {}) {
  spawnSync(command, args, {
    stdio: "inherit",
    ...options,
  });
}

function waitForReady(maxAttempts = 20) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const result = spawnSync(
      "docker",
      ["exec", CONTAINER_NAME, "pg_isready", "-U", "postgres", "-d", DB_NAME],
      { stdio: "ignore" }
    );

    if (result.status === 0) {
      return;
    }

    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
  }

  throw new Error("PostgreSQL container did not become ready in time.");
}

function runSmokeScript(scriptPath) {
  runCommand("node", ["--env-file=.env", scriptPath], {
    env: {
      ...process.env,
      DATABASE_URL,
    },
  });
}

async function main() {
  console.log("[realtime-smoke] Cleaning previous container...");
  runCommandAllowFailure("docker", ["rm", "-f", CONTAINER_NAME]);

  console.log("[realtime-smoke] Starting pgvector container...");
  runCommand("docker", [
    "run",
    "-d",
    "--name",
    CONTAINER_NAME,
    "-e",
    "POSTGRES_HOST_AUTH_METHOD=trust",
    "-e",
    `POSTGRES_DB=${DB_NAME}`,
    "-p",
    `${HOST_PORT}:5432`,
    IMAGE,
  ]);

  console.log("[realtime-smoke] Waiting for readiness...");
  waitForReady();

  console.log("[realtime-smoke] Running GraphQL noteUpdated subscription smoke...");
  runSmokeScript("scripts/smoke/graphql-subscription-noteupdated-smoke.js");

  console.log("[realtime-smoke] Running realistic autosave smoke (1-2 min)...");
  runSmokeScript("scripts/smoke/autosave-realistic-smoke.js");

  console.log("[realtime-smoke] All realtime/autosave smokes passed.");
}

main()
  .catch((error) => {
    console.error("[realtime-smoke] Failed:");
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => {
    console.log("[realtime-smoke] Cleaning test container...");
    runCommandAllowFailure("docker", ["rm", "-f", CONTAINER_NAME]);
  });
