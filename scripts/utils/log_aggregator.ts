import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export function classifyLog(content: string): [string, string, boolean] {
  const lines = content.split(/\r?\n/);
  const explicitFailurePatterns = [
    '::error:: Compilation failed',
    '::error:: Build or pack failed',
    '] Build failed:',
    '] Pack failed:',
    '] Failed to restore stage directory:',
    'has no usable published candidate.',
  ];
  const isExplicitFailureLine = (line: string): boolean => {
    const trimmed = line.trimStart();
    return trimmed.startsWith('::error:: ') && explicitFailurePatterns.some((kw) => trimmed.includes(kw));
  };
  const hasExplicitCompileFailure = lines.some(isExplicitFailureLine);
  const hasSmokeTestFailure =
    content.includes('Smoke test failed') ||
    content.includes('Smoke test timed out') ||
    content.includes('QEMU emulation crash') ||
    content.includes('❌ STATUS: TEST FAILURE') ||
    /Smoke test.*failed/i.test(content);
  const hasSmokeTestPass = content.includes('Smoke test passed') || content.includes('✓ [');
  const hasSmokeTestSkipped =
    content.includes('Neither stage_dir nor package output exist for test') ||
    content.includes('Notice: Neither stage_dir nor package output exist') ||
    content.includes('[SMOKE_TEST_SKIPPED]');
  const stageHeaderRegex = /^=== STAGE:\s+([A-Z_ &]+?)(?:\s+(?:\(.*\)|\[.*\]))?\s+===$/;
  const testStageIdx = lines.findIndex((l) => {
    const m = l.trim().match(stageHeaderRegex);
    return m?.[1] === 'TEST';
  });
  const hasTestStage = testStageIdx !== -1;
  const hasSubcommandFailedInCompile = lines.some((line, idx) => {
    if (hasTestStage && idx >= testStageIdx) {
      return false;
    }
    return line.includes('ninja: build stopped: subcommand failed') || line.includes('cgo: C compiler');
  });
  const hasCompileFailure =
    hasExplicitCompileFailure ||
    (!hasSmokeTestPass && !hasSmokeTestSkipped && !hasSmokeTestFailure && hasSubcommandFailedInCompile);
  const hasException =
    content.includes('error:') ||
    content.includes('Error:') ||
    content.includes('fatal error:') ||
    content.includes('panic:');

  if (hasCompileFailure) {
    const errorKeywords = ['error:', 'Error:', 'fatal error:', 'panic:', 'FAILED:', 'undefined reference to'];
    const markerLines: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (
        isExplicitFailureLine(line) ||
        line.includes('ninja: build stopped: subcommand failed') ||
        line.includes('cgo: C compiler')
      ) {
        const start = Math.max(0, i - 2);
        const end = Math.min(lines.length, i + 4);
        for (let j = start; j < end; j++) {
          if (!markerLines.includes(lines[j])) {
            markerLines.push(lines[j]);
          }
        }
      }
    }

    const errorSnippets: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (errorKeywords.some((kw) => line.includes(kw)) && !line.trim().startsWith('note:')) {
        const start = Math.max(0, i - 2);
        const end = Math.min(lines.length, i + 4);
        errorSnippets.push(...lines.slice(start, end));
        errorSnippets.push('---');
      }
    }

    const dedupedErrors: string[] = [];
    for (const item of errorSnippets) {
      if (dedupedErrors.length === 0 || item !== dedupedErrors[dedupedErrors.length - 1]) {
        dedupedErrors.push(item);
      }
    }

    const explicitFailureLines: string[] = [];
    for (const line of lines) {
      if (isExplicitFailureLine(line)) {
        if (!explicitFailureLines.includes(line)) {
          explicitFailureLines.push(line);
        }
      }
    }

    let detail = '';
    const totalBudget = 50;
    const cappedExplicitLines = explicitFailureLines.slice(0, totalBudget);
    const remainingMarkerCap = Math.min(
      Math.max(0, 15 - cappedExplicitLines.length),
      Math.max(0, totalBudget - cappedExplicitLines.length),
    );
    const contextualMarkerLines = markerLines
      .filter((l) => !cappedExplicitLines.includes(l))
      .slice(0, remainingMarkerCap);
    const reservedMarkerLines = [...cappedExplicitLines, ...contextualMarkerLines];
    const remainingCap = Math.max(0, totalBudget - reservedMarkerLines.length);
    const selectedErrors = dedupedErrors.slice(0, remainingCap);
    const combined = [...reservedMarkerLines, ...selectedErrors];

    if (combined.length > 0) {
      detail = combined.join('\n');
    } else {
      detail = lines.slice(-30).join('\n');
    }
    return ['❌ STATUS: BUILD FAILURE', detail, true];
  }

  const testSectionIndices: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].trim().match(stageHeaderRegex);
    if (m && m[1] === 'TEST') {
      testSectionIndices.push(i);
    }
  }

  interface TestSectionOutcome {
    headerIdx: number;
    header: string;
    status: 'pass' | 'skip' | 'fail';
    detail: string;
  }

  const testOutcomes: TestSectionOutcome[] = [];
  for (let s = 0; s < testSectionIndices.length; s++) {
    const startIdx = testSectionIndices[s];
    const nextStageIdx = lines.findIndex(
      (l, idx) =>
        idx > startIdx &&
        (stageHeaderRegex.test(l.trim()) || (s + 1 < testSectionIndices.length && idx === testSectionIndices[s + 1])),
    );
    const endIdx = nextStageIdx !== -1 ? nextStageIdx : lines.length;
    const secLines = lines.slice(startIdx, endIdx);
    const secContent = secLines.join('\n');

    const secHasFail =
      secContent.includes('Smoke test failed') ||
      secContent.includes('Smoke test timed out') ||
      secContent.includes('QEMU emulation crash') ||
      secContent.includes('❌ STATUS: TEST FAILURE') ||
      /Smoke test.*failed/i.test(secContent);
    const secHasPass =
      secContent.includes('Smoke test passed') ||
      secContent.includes('Stage-only smoke test passed') ||
      secContent.includes('Smoke test passed in container') ||
      secContent.includes('Smoke test passed locally');
    const secHasSkip =
      secContent.includes('Neither stage_dir nor package output exist for test') ||
      secContent.includes('Notice: Neither stage_dir nor package output exist') ||
      secContent.includes('[SMOKE_TEST_SKIPPED]');
    const secHasInterruption =
      !secHasPass &&
      !secHasSkip &&
      (secContent.includes('fatal error:') ||
        secContent.includes('panic:') ||
        secContent.includes('error:') ||
        secContent.includes('Error:'));

    if (secHasFail || secHasInterruption) {
      const failureIndices: number[] = [];
      for (let i = 0; i < secLines.length; i++) {
        const l = secLines[i];
        if (
          l.includes('Smoke test failed') ||
          l.includes('Smoke test timed out') ||
          l.includes('QEMU emulation crash') ||
          l.includes('STDERR:') ||
          l.includes('STDOUT:') ||
          l.includes('fatal error:') ||
          l.includes('panic:') ||
          l.includes('error:') ||
          l.includes('Error:')
        ) {
          failureIndices.push(i);
        }
      }
      let secDetail = '';
      if (failureIndices.length > 0) {
        let terminalIdx = -1;
        for (let i = secLines.length - 1; i >= 0; i--) {
          const l = secLines[i];
          if (
            l.includes('Smoke test failed') ||
            l.includes('Smoke test timed out') ||
            l.includes('QEMU emulation crash') ||
            l.includes('❌ STATUS: TEST FAILURE')
          ) {
            terminalIdx = i;
            break;
          }
        }

        const maxLines = 40;
        let dStart: number;
        let dEnd: number;

        if (terminalIdx !== -1) {
          const first = failureIndices[0];
          if (terminalIdx - first < maxLines - 5) {
            dStart = Math.max(0, first - 3);
            dEnd = Math.min(secLines.length, dStart + maxLines);
          } else {
            dEnd = Math.min(secLines.length, terminalIdx + 3);
            dStart = Math.max(0, dEnd - maxLines);
          }
        } else {
          const first = failureIndices[0];
          dStart = Math.max(0, first - 5);
          dEnd = Math.min(secLines.length, dStart + maxLines);
        }
        secDetail = secLines.slice(dStart, dEnd).join('\n');
      } else {
        secDetail =
          secLines.length <= 25 ? secLines.join('\n') : [secLines[0], '...', ...secLines.slice(-24)].join('\n');
      }
      testOutcomes.push({ headerIdx: startIdx, header: lines[startIdx], status: 'fail', detail: secDetail });
    } else if (secHasPass) {
      testOutcomes.push({ headerIdx: startIdx, header: lines[startIdx], status: 'pass', detail: '' });
    } else if (secHasSkip) {
      testOutcomes.push({ headerIdx: startIdx, header: lines[startIdx], status: 'skip', detail: '' });
    } else {
      const secDetail =
        secLines.length <= 25 ? secLines.join('\n') : [secLines[0], '...', ...secLines.slice(-24)].join('\n');
      testOutcomes.push({ headerIdx: startIdx, header: lines[startIdx], status: 'fail', detail: secDetail });
    }
  }

  const failingOutcome = testOutcomes.find((o) => o.status === 'fail');
  if (testSectionIndices.length > 0) {
    if (failingOutcome) {
      return ['❌ STATUS: TEST FAILURE', failingOutcome.detail, true];
    }
  } else if (hasSmokeTestFailure) {
    return ['❌ STATUS: TEST FAILURE', lines.slice(-25).join('\n'), true];
  }

  if (testOutcomes.length > 0 && testOutcomes.every((o) => o.status === 'pass' || o.status === 'skip')) {
    return ['✓ STATUS: SUCCESS', '', false];
  }

  if (hasException) {
    const errorSnippets: string[] = [];
    const errorKeywords = ['error:', 'Error:', 'fatal error:', 'panic:', 'FAILED:'];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (errorKeywords.some((kw) => line.includes(kw)) && !line.trim().startsWith('note:')) {
        const start = Math.max(0, i - 2);
        const end = Math.min(lines.length, i + 4);
        errorSnippets.push(...lines.slice(start, end));
        errorSnippets.push('---');
      }
    }
    const detail = errorSnippets.length > 0 ? errorSnippets.slice(0, 50).join('\n') : lines.slice(-30).join('\n');
    return ['❌ STATUS: BUILD FAILURE', detail, true];
  }

  return ['✓ STATUS: SUCCESS', '', false];
}

function findLogFiles(dir: string): string[] {
  const results: string[] = [];
  if (!existsSync(dir)) {
    return results;
  }

  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findLogFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.log')) {
      results.push(fullPath);
    }
  }
  return results.sort();
}

export function generateSummary(logsDir: string, outputFile: string): boolean {
  const summary: string[] = [
    '================================================================================',
    'REPOEXE CI/CD BUILD & TEST SUMMARY',
    '================================================================================',
    '',
  ];

  const logFiles = findLogFiles(logsDir);
  if (logFiles.length === 0) {
    summary.push('No logs found. The matrix job likely failed completely before running any target steps.');
    writeFileSync(outputFile, summary.join('\n'), 'utf-8');
    return true;
  }

  let hasFailures = false;
  for (const logPath of logFiles) {
    const target =
      logPath
        .split('/')
        .pop()
        ?.replace(/\.log$/, '') || 'unknown';
    const content = readFileSync(logPath, 'utf-8');

    summary.push(`--- TARGET: ${target} ---`);
    const [statusStr, detail, isFail] = classifyLog(content);

    if (isFail) {
      hasFailures = true;
    }

    summary.push(statusStr);
    if (detail) {
      summary.push(detail);
    }
    summary.push('\n');
  }

  writeFileSync(outputFile, summary.join('\n'), 'utf-8');
  return hasFailures;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.length !== 2) {
    console.log('Usage: bun run log_aggregator.ts <logs_dir> <output_file>');
    process.exit(1);
  }

  const hasAnyFailure = generateSummary(resolve(args[0]), resolve(args[1]));
  if (hasAnyFailure) {
    console.error('::error:: One or more build/test targets failed in CI matrix.');
    process.exit(1);
  }
}
