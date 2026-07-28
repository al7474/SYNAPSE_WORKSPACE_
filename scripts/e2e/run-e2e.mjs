import { spawnSync } from "node:child_process";

const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const environment = {
  ...process.env,
  DATABASE_URL:
    process.env.DATABASE_URL ||
    "postgresql://postgres:postgres@127.0.0.1:5434/synapse",
};

function run(commandArguments) {
  const result = spawnSync(pnpmCommand, commandArguments, {
    env: environment,
    shell: process.platform === "win32",
    stdio: "inherit",
  });

  if (result.error) {
    console.error(result.error);
    return 1;
  }

  return result.status ?? 1;
}

const migrationStatus = run(["db:migrate:deploy"]);

if (migrationStatus !== 0) {
  process.exit(migrationStatus);
}

process.exit(run(["exec", "--", "playwright", "test", ...process.argv.slice(2)]));