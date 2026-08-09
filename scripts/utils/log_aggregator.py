import sys
from pathlib import Path


def classify_log(content: str) -> tuple[str, str, bool]:
    lines = content.splitlines()
    has_traceback = "Traceback (most recent call last):" in content or "RuntimeError:" in content
    has_subcommand_failed = "ninja: build stopped: subcommand failed" in content or "cgo: C compiler" in content
    has_smoke_test_failure = "Smoke test failed for" in content
    has_smoke_test_pass = "Smoke test passed" in content or "✓ [" in content
    has_pack_stage = "=== STAGE: PACK ===" in content

    if has_smoke_test_failure:
        failure_lines = []
        capture = False
        for line in lines:
            if "Smoke test failed" in line or "STDERR:" in line or "STDOUT:" in line:
                capture = True
            if capture:
                failure_lines.append(line)
                if len(failure_lines) > 30:
                    break
        detail = "\n".join(failure_lines) if failure_lines else "\n".join(lines[-25:])
        return "❌ STATUS: TEST FAILURE", detail, True
    elif has_traceback or has_subcommand_failed or not has_pack_stage:
        detail = "\n".join(lines[-30:])
        return "❌ STATUS: BUILD FAILURE", detail, True
    elif has_smoke_test_pass or has_pack_stage:
        return "✓ STATUS: SUCCESS", "", False
    else:
        return "✓ STATUS: SUCCESS", "", False


def generate_summary(logs_dir: Path, output_file: Path) -> bool:
    summary = [
        "================================================================================",
        "REPOEXE CI/CD BUILD & TEST SUMMARY",
        "================================================================ dialect\n",
    ]

    if not logs_dir.exists() or not any(logs_dir.iterdir()):
        summary.append(
            "No logs found. The matrix job likely failed completely before running any target steps."
        )
        output_file.write_text("\n".join(summary), encoding="utf-8")
        return True

    has_failures = False
    for log_file in sorted(logs_dir.rglob("*.log")):
        target = log_file.stem
        content = log_file.read_text(errors="replace")

        summary.append(f"--- TARGET: {target} ---")
        status_str, detail, is_fail = classify_log(content)

        if is_fail:
            has_failures = True

        summary.append(status_str)
        if detail:
            summary.append(detail)
        summary.append("\n")

    output_file.write_text("\n".join(summary), encoding="utf-8")
    return has_failures


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("Usage: python3 log_aggregator.py <logs_dir> <output_file>")
        sys.exit(1)

    has_any_failure = generate_summary(Path(sys.argv[1]), Path(sys.argv[2]))
    if has_any_failure:
        print("::error:: One or more build/test targets failed in CI matrix.")
        sys.exit(1)
