#!/usr/bin/env node

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();

const ignoreFileGlobs = [
  /^pnpm-lock\.yaml$/,
  /^package-lock\.json$/,
  /^yarn\.lock$/,
  /^\.git\//,
  /^node_modules\//,
  /^dist\//,
  /^frontend\/\.next\//,
  /^coverage\//,
  /^generated-images\//,
];

const ignoreExtensions = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".pdf",
  ".zip",
  ".gz",
  ".7z",
  ".woff",
  ".woff2",
]);

const highRiskPatterns = [
  {
    name: "OpenRouter API key",
    regex: /(?:OPENROUTER_API_KEY\s*[=:]\s*|sk-or-v1-)[A-Za-z0-9_\-]{16,}/,
  },
  {
    name: "Generic API key assignment",
    regex: /(?:API[_-]?KEY|TOKEN|SECRET)\s*[=:]\s*["']?[A-Za-z0-9_\-]{20,}["']?/i,
  },
  {
    name: "Private key block",
    regex: /-----BEGIN (?:RSA |EC |OPENSSH |)?PRIVATE KEY-----/,
  },
  {
    name: "AWS access key",
    regex: /AKIA[0-9A-Z]{16}/,
  },
  {
    name: "GitHub token",
    regex: /gh[pousr]_[A-Za-z0-9]{20,}/,
  },
];

const allowedLinePatterns = [
  /invalid_api_key_for_smoke_test/i,
  /example|placeholder|dummy/i,
];

function getTrackedFiles() {
  const output = execSync("git ls-files", { encoding: "utf8" }).trim();
  return output ? output.split(/\r?\n/).filter(Boolean) : [];
}

function shouldIgnore(filePath) {
  if (ignoreFileGlobs.some((pattern) => pattern.test(filePath))) {
    return true;
  }

  const extension = path.extname(filePath).toLowerCase();
  if (ignoreExtensions.has(extension)) {
    return true;
  }

  return false;
}

function findMatches(filePath, content) {
  const lines = content.split(/\r?\n/);
  const matches = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];

    if (!line || line.trim().startsWith("#")) {
      continue;
    }

    for (const pattern of highRiskPatterns) {
      if (pattern.regex.test(line)) {
        if (allowedLinePatterns.some((allowedPattern) => allowedPattern.test(line))) {
          continue;
        }

        matches.push({
          filePath,
          line: i + 1,
          pattern: pattern.name,
          snippet: line.trim().slice(0, 180),
        });
      }
    }
  }

  return matches;
}

function main() {
  const trackedFiles = getTrackedFiles();
  const findings = [];

  for (const relativePath of trackedFiles) {
    if (shouldIgnore(relativePath)) {
      continue;
    }

    const absolutePath = path.join(repoRoot, relativePath);

    let content;
    try {
      content = fs.readFileSync(absolutePath, "utf8");
    } catch {
      continue;
    }

    findings.push(...findMatches(relativePath, content));
  }

  if (findings.length > 0) {
    console.error("Secret scan failed. Potential secret-like values detected:\n");

    for (const finding of findings) {
      console.error(
        `- ${finding.filePath}:${finding.line} (${finding.pattern}) -> ${finding.snippet}`
      );
    }

    console.error("\nIf a value is intentional and non-secret, replace it with a safe placeholder.");
    process.exit(1);
  }

  console.log("Secret scan passed. No high-risk secret patterns were found in tracked files.");
}

main();
