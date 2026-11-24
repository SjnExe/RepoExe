import { expect, test } from 'bun:test';

import { classifyLog } from '../utils/log_aggregator.ts';

test('classifyLog detects smoke test failure correctly', (): void => {
  const logContent = `
=== STAGE: COMPILE ===
Build complete
=== STAGE: PACK ===
Pack complete
=== STAGE: TEST ===
Executing container smoke test...
Error: Smoke test failed with exit code 127 for testpkg
`;
  const [status, detail, isFail] = classifyLog(logContent);
  expect(isFail).toBeTrue();
  expect(status).toBe('❌ STATUS: TEST FAILURE');
  expect(detail).toContain('Smoke test failed');
});

test('classifyLog detects emulation timeout and qemu crash', (): void => {
  const timeoutLog = `
=== STAGE: PACK ===
=== STAGE: TEST ===
Error: Smoke test timed out after 120s under emulation for aisleriot
`;
  const [status, _detail, isFail] = classifyLog(timeoutLog);
  expect(isFail).toBeTrue();
  expect(status).toBe('❌ STATUS: TEST FAILURE');

  const crashLog = `
=== STAGE: PACK ===
=== STAGE: TEST ===
Error: QEMU emulation crash (signal 139) executing aisleriot
`;
  const [cStatus, , cFail] = classifyLog(crashLog);
  expect(cFail).toBeTrue();
  expect(cStatus).toBe('❌ STATUS: TEST FAILURE');
});

test('classifyLog does not mask test failures with stage pack', (): void => {
  const logWithPackAndFailedTest = `
=== STAGE: PACK ===
Pack success
=== STAGE: TEST ===
Segmentation fault (core dumped)
fatal error: runtime error
`;
  const [status, , isFail] = classifyLog(logWithPackAndFailedTest);
  expect(isFail).toBeTrue();
  expect(status).toBe('❌ STATUS: TEST FAILURE');
});

test('classifyLog reports success when smoke test passes', (): void => {
  const containerSuccessLog = `
=== STAGE: COMPILE ===
=== STAGE: PACK ===
=== STAGE: TEST ===
✓ Smoke test passed in container for repoexe
`;
  const [status, , isFail] = classifyLog(containerSuccessLog);
  expect(isFail).toBeFalse();
  expect(status).toBe('✓ STATUS: SUCCESS');

  const localSuccessLog = `
=== STAGE: COMPILE ===
=== STAGE: PACK ===
=== STAGE: TEST ===
✓ Smoke test passed locally for repoexe
`;
  const [localStatus, , localFail] = classifyLog(localSuccessLog);
  expect(localFail).toBeFalse();
  expect(localStatus).toBe('✓ STATUS: SUCCESS');

  const successWithCompilerProbesLog = `
=== STAGE: COMPILE ===
Checking for function "pthread_create": NO (error: implicit declaration of function)
fatal error: sys/cdefs.h: No such file or directory (ignoring optional check)
=== STAGE: PACK ===
Pack complete
=== STAGE: TEST ===
Executing container smoke test...
✓ Smoke test passed in container for aisleriot
`;
  const [probeStatus, , probeFail] = classifyLog(successWithCompilerProbesLog);
  expect(probeFail).toBeFalse();
  expect(probeStatus).toBe('✓ STATUS: SUCCESS');
});

test('classifyLog preserves compile failure when both failure and success coexist (Thread #31)', (): void => {
  const mixedLog = `
=== STAGE: COMPILE ===
::error:: Compilation failed for beta
=== STAGE: TEST ===
✓ Smoke test passed in container for alpha
`;
  const [status, , isFail] = classifyLog(mixedLog);
  expect(isFail).toBeTrue();
  expect(status).toBe('❌ STATUS: BUILD FAILURE');
});

test('classifyLog does not let generic tool output override smoke test failure (Thread #41)', (): void => {
  const logWithCgoInTest = `
=== STAGE: COMPILE ===
Build complete
=== STAGE: PACK ===
Pack complete
=== STAGE: TEST ===
cgo: C compiler "gcc" not found
Smoke test failed with exit code 1
`;
  const [status, detail, isFail] = classifyLog(logWithCgoInTest);
  expect(isFail).toBeTrue();
  expect(status).toBe('❌ STATUS: TEST FAILURE');
  expect(detail).toContain('Smoke test failed');
});

test('classifyLog recognizes skipped smoke test as success (Thread #42)', (): void => {
  const skippedTestLog = `
=== STAGE: COMPILE ===
Build complete
=== STAGE: PACK ===
Pack complete
=== STAGE: TEST ===
Notice: Neither stage_dir nor package output exist for test (repoexe).
`;
  const [status, , isFail] = classifyLog(skippedTestLog);
  expect(isFail).toBeFalse();
  expect(status).toBe('✓ STATUS: SUCCESS');
});

test('classifyLog reserves space for compilation failed marker over earlier error lines (Thread #30)', (): void => {
  const manyErrors = Array.from({ length: 60 }, (_, i) => `error: generic error message ${i}`).join('\n');
  const compileLog = `
=== STAGE: COMPILE ===
${manyErrors}
::error:: Compilation failed for targetpkg
`;
  const [status, detail, isFail] = classifyLog(compileLog);
  expect(isFail).toBeTrue();
  expect(status).toBe('❌ STATUS: BUILD FAILURE');
  expect(detail).toContain('::error:: Compilation failed for targetpkg');
});

test('Finding #15: classifyLog flags build.ts Build failed marker even when test stage skips', (): void => {
  const log = `
=== STAGE: COMPILE & PACK (demo [aarch64]) ===
::error:: [demo] Build failed: make phase failed for demo
=== STAGE: TEST (demo [aarch64]) ===
Notice: Neither stage_dir nor package output exist for test (demo).
`;
  const [status, detail, isFail] = classifyLog(log);
  expect(isFail).toBeTrue();
  expect(status).toBe('❌ STATUS: BUILD FAILURE');
  expect(detail).toContain('::error:: [demo] Build failed:');
});

test('classifyLog recognizes [SMOKE_TEST_SKIPPED] marker as success', (): void => {
  const skippedLog = `
=== STAGE: COMPILE ===
Build complete
=== STAGE: PACK ===
Pack complete
=== STAGE: TEST ===
[SMOKE_TEST_SKIPPED] demo
`;
  const [status, , isFail] = classifyLog(skippedLog);
  expect(isFail).toBeFalse();
  expect(status).toBe('✓ STATUS: SUCCESS');
});

test('classifyLog gives smoke test pass precedence over benign cgo or ninja subcommand lines', (): void => {
  const cgoAndPass = `
=== STAGE: COMPILE ===
cgo: C compiler "gcc" not found
=== STAGE: TEST ===
✓ Smoke test passed in container for demo
`;
  expect(classifyLog(cgoAndPass)).toEqual(['✓ STATUS: SUCCESS', '', false]);

  const ninjaAndPass = `
=== STAGE: COMPILE ===
ninja: build stopped: subcommand failed
=== STAGE: TEST ===
✓ Smoke test passed in container for demo
`;
  expect(classifyLog(ninjaAndPass)).toEqual(['✓ STATUS: SUCCESS', '', false]);
});

test('classifyLog classifies standalone cgo or ninja subcommand failure as build failure', (): void => {
  const ninjaOnly = `
=== STAGE: COMPILE ===
ninja: build stopped: subcommand failed
`;
  const [status1, detail1, isFail1] = classifyLog(ninjaOnly);
  expect(isFail1).toBeTrue();
  expect(status1).toBe('❌ STATUS: BUILD FAILURE');
  expect(detail1).toContain('ninja: build stopped: subcommand failed');

  const cgoOnly = `
=== STAGE: COMPILE ===
cgo: C compiler "clang" failed
`;
  const [status2, detail2, isFail2] = classifyLog(cgoOnly);
  expect(isFail2).toBeTrue();
  expect(status2).toBe('❌ STATUS: BUILD FAILURE');
  expect(detail2).toContain('cgo: C compiler');
});

test('classifyLog ignores unprefixed failure phrases when smoke test passes', (): void => {
  const benignOutput = `
=== STAGE: COMPILE ===
Pack failed: simulated unit test fixture output
Compilation failed for mock test
Packaging failed in self-test
=== STAGE: TEST ===
✓ Smoke test passed in container for demo
`;
  expect(classifyLog(benignOutput)).toEqual(['✓ STATUS: SUCCESS', '', false]);
});

test('classifyLog does not let an earlier skip hide a later interrupted test (Thread #29)', (): void => {
  const mixedSkipAndFail = `
=== STAGE: TEST (alpha) ===
[SMOKE_TEST_SKIPPED] alpha
=== STAGE: TEST (beta) ===
fatal error: runtime error
`;
  const [status, detail, isFail] = classifyLog(mixedSkipAndFail);
  expect(isFail).toBeTrue();
  expect(status).toBe('❌ STATUS: TEST FAILURE');
  expect(detail).toContain('fatal error: runtime error');
});

test('classifyLog recognizes stage-only smoke test pass (Thread #28)', (): void => {
  const stageOnlyPassLog = `
=== STAGE: COMPILE ===
Build complete
=== STAGE: PACK ===
Pack complete
=== STAGE: TEST ===
✓ Stage-only smoke test passed locally for repoexe (no archives promoted)
`;
  const [status, , isFail] = classifyLog(stageOnlyPassLog);
  expect(isFail).toBeFalse();
  expect(status).toBe('✓ STATUS: SUCCESS');
});

test('classifyLog reserves space for terminal smoke test failure marker over earlier stdout (Thread #29)', (): void => {
  const manyStdoutLines = Array.from({ length: 60 }, (_, i) => `STDOUT: diagnostic output line ${i}`).join('\n');
  const testLog = `
=== STAGE: COMPILE ===
Build complete
=== STAGE: PACK ===
Pack complete
=== STAGE: TEST ===
${manyStdoutLines}
::error:: Smoke test failed for targetpkg with exit code 1
`;
  const [status, detail, isFail] = classifyLog(testLog);
  expect(isFail).toBeTrue();
  expect(status).toBe('❌ STATUS: TEST FAILURE');
  expect(detail).toContain('::error:: Smoke test failed for targetpkg');
});

test('classifyLog handles nested bracket qualifiers and test script echo strings without false build failure', (): void => {
  const log = `
=== STAGE: COMPILE & PACK (demo [aarch64]) ===
⚡ Compiling demo...
✓ Build completed.
=== STAGE: TEST (demo [aarch64]) ===
Running smoke test for demo:
if [ -z "$BIN" ]; then
  echo "Error: binary not found in stage" >&2
  exit 1
fi
✓ Smoke test passed in container for demo
`;
  const [status, detail, isFail] = classifyLog(log);
  expect(isFail).toBeFalse();
  expect(status).toBe('✓ STATUS: SUCCESS');
  expect(detail).toBe('');
});

test('classifyLog records success when compiler probe emits error: but qualified smoke test passes', (): void => {
  const log = `
=== STAGE: COMPILE & PACK (demo [aarch64]) ===
checking whether compiler supports -fstack-protector... no
conftest.c:1:2: error: #error unsupported
✓ Build completed.
=== STAGE: TEST (demo [aarch64]) ===
Running smoke test for demo...
✓ Smoke test passed in container for demo
`;
  const [status, detail, isFail] = classifyLog(log);
  expect(isFail).toBeFalse();
  expect(status).toBe('✓ STATUS: SUCCESS');
  expect(detail).toBe('');
});
