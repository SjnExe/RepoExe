import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

export function classifyLog(content: string): [string, string, boolean] {
  const lines = content.split(/\r?\n/);
  const hasSubcommandFailed =
    content.includes("ninja: build stopped: subcommand failed") ||
    content.includes("cgo: C compiler");
  const hasSmokeTestFailure = content.includes("Smoke test failed for");
  const hasSmokeTestPass = content.includes("Smoke test passed") || content.includes("✓ [");
  const hasPackStage = content.includes("=== STAGE: PACK ===");
  const hasException = content.includes("error:") || content.includes("Error:") || content.includes("fatal error:");

  if (hasSmokeTestFailure) {
    const failureLines: string[] = [];
    let capture = false;
    for (const line of lines) {
      if (line.includes("Smoke test failed") || line.includes("STDERR:") || line.includes("STDOUT:")) {
        capture = true;
      }
      if (capture) {
        failureLines.push(line);
        if (failureLines.length > 40) break;
      }
    }
    const detail = failureLines.length > 0 ? failureLines.join("\n") : lines.slice(-25).join("\n");
    return ["❌ STATUS: TEST FAILURE", detail, true];
  }

  if (hasSubcommandFailed || (!hasPackStage && hasException)) {
    const errorSnippets: string[] = [];
    const errorKeywords = ["error:", "fatal error:", "panic:", "FAILED:", "undefined reference to"];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (errorKeywords.some((kw) => line.includes(kw)) && !line.trim().startsWith("note:")) {
        const start = Math.max(0, i - 2);
        const end = Math.min(lines.length, i + 4);
        errorSnippets.push(...lines.slice(start, end));
        errorSnippets.push("---");
      }
    }

    let detail = "";
    if (errorSnippets.length > 0) {
      const deduped: string[] = [];
      for (const item of errorSnippets) {
        if (deduped.length === 0 || item !== deduped[deduped.length - 1]) {
          deduped.push(item);
        }
      }
      detail = deduped.slice(0, 50).join("\n");
    } else {
      detail = lines.slice(-30).join("\n");
    }
    return ["❌ STATUS: BUILD FAILURE", detail, true];
  }

  if (hasSmokeTestPass || hasPackStage) {
    return ["✓ STATUS: SUCCESS", "", false];
  }

  return ["✓ STATUS: SUCCESS", "", false];
}

function findLogFiles(dir: string): string[] {
  const results: string[] = [];
  if (!existsSync(dir)) return results;

  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findLogFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith(".log")) {
      results.push(fullPath);
    }
  }
  return results.sort();
}

export function generateSummary(logsDir: string, outputFile: string): boolean {
  const summary: string[] = [
    "================================================================================",
    "REPOEXE CI/CD BUILD & TEST SUMMARY",
    "================================================================================",
    "",
  ];

  const logFiles = findLogFiles(logsDir);
  if (logFiles.length === 0) {
    summary.push("No logs found. The matrix job likely failed completely before running any target steps.");
    writeFileSync(outputFile, summary.join("\n"), "utf-8");
    return true;
  }

  let hasFailures = false;
  for (const logPath of logFiles) {
    const target = logPath.split("/").pop()?.replace(/\.log$/, "") || "unknown";
    const content = readFileSync(logPath, "utf-8");

    summary.push(`--- TARGET: ${target} ---`);
    const [statusStr, detail, isFail] = classifyLog(content);

    if (isFail) {
      hasFailures = true;
    }

    summary.push(statusStr);
    if (detail) {
      summary.push(detail);
    }
    summary.push("\n");
  }

  writeFileSync(outputFile, summary.join("\n"), "utf-8");
  return hasFailures;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.length !== 2) {
    console.log("Usage: bun run log_aggregator.ts <logs_dir> <output_file>");
    process.exit(1);
  }

  const hasAnyFailure = generateSummary(resolve(args[0]), resolve(args[1]));
  if (hasAnyFailure) {
    console.error("::error:: One or more build/test targets failed in CI matrix.");
    process.exit(1);
  }
}
