import { expect, test } from "bun:test";
import { classifyLog } from "../utils/log_aggregator.ts";

test("classifyLog detects smoke test failure correctly", () => {
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
  expect(status).toBe("❌ STATUS: TEST FAILURE");
  expect(detail).toContain("Smoke test failed");
});

test("classifyLog detects emulation timeout and qemu crash", () => {
  const timeoutLog = `
=== STAGE: PACK ===
=== STAGE: TEST ===
Error: Smoke test timed out after 120s under emulation for aisleriot
`;
  const [status, detail, isFail] = classifyLog(timeoutLog);
  expect(isFail).toBeTrue();
  expect(status).toBe("❌ STATUS: TEST FAILURE");

  const crashLog = `
=== STAGE: PACK ===
=== STAGE: TEST ===
Error: QEMU emulation crash (signal 139) executing aisleriot
`;
  const [cStatus, , cFail] = classifyLog(crashLog);
  expect(cFail).toBeTrue();
  expect(cStatus).toBe("❌ STATUS: TEST FAILURE");
});

test("classifyLog does not mask test failures with stage pack", () => {
  const logWithPackAndFailedTest = `
=== STAGE: PACK ===
Pack success
=== STAGE: TEST ===
Segmentation fault (core dumped)
fatal error: runtime error
`;
  const [status, , isFail] = classifyLog(logWithPackAndFailedTest);
  expect(isFail).toBeTrue();
  expect(status).toBe("❌ STATUS: TEST FAILURE");
});

test("classifyLog reports success when smoke test passes", () => {
  const successLog = `
=== STAGE: COMPILE ===
=== STAGE: PACK ===
=== STAGE: TEST ===
✓ Smoke test passed in container for repoexe
`;
  const [status, , isFail] = classifyLog(successLog);
  expect(isFail).toBeFalse();
  expect(status).toBe("✓ STATUS: SUCCESS");
});
