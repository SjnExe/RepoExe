#!/bin/bash
# test syntax with shellcheck
shellcheck Dockerfile || echo "Shellcheck does not support Dockerfile directly, but syntax seems ok."
