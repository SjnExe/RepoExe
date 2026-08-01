import sys
from pathlib import Path


def generate_summary(logs_dir: Path, output_file: Path):
    """
    Parses all logs in logs_dir and generates a concise, readable summary of build/test status,
    filtering out noisy installation/setup steps.
    """
    summary = []
    summary.append(
        "================================================================================"
    )
    summary.append("REPOEXE CI/CD BUILD & TEST SUMMARY")
    summary.append(
        "================================================================================\n"
    )

    if not logs_dir.exists() or not any(logs_dir.iterdir()):
        summary.append(
            "No logs found. The matrix job likely failed completely before running any target steps."
        )
        output_file.write_text("\n".join(summary))
        return

    for log_file in sorted(logs_dir.rglob("*.log")):
        target = log_file.stem
        content = log_file.read_text(errors="replace")

        summary.append(f"--- TARGET: {target} ---")

        # Analyze log for failure markers
        if "❌" in content or "failed" in content.lower() or "error" in content.lower():
            # Extract test failures specifically
            if "Smoke test failed" in content:
                summary.append("❌ STATUS: TEST FAILURE")

                # Extract the stderr from the smoke test failure
                test_output = ""
                capture = False
                for line in content.splitlines():
                    if "Smoke test failed for" in line:
                        capture = True
                    if capture:
                        test_output += line + "\n"
                        # Stop capturing after reasonable test output length or end of file
                        if len(test_output) > 2000:
                            test_output += "... (truncated)"
                            break
                summary.append(test_output)

            else:
                summary.append("❌ STATUS: BUILD FAILURE")
                # Grab the last 30 lines which usually contain the build error
                lines = content.splitlines()[-30:]
                summary.append("\n".join(lines))
        else:
            if "✓" in content or "successfully" in content.lower():
                summary.append("✓ STATUS: SUCCESS")
            else:
                summary.append("? STATUS: UNKNOWN (Log truncated or status unclear)")

        summary.append("\n")

    output_file.write_text("\n".join(summary))


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("Usage: python3 log_aggregator.py <logs_dir> <output_file>")
        sys.exit(1)

    generate_summary(Path(sys.argv[1]), Path(sys.argv[2]))
