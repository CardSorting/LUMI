#!/bin/bash

# JoyZoning: Structural Commit Guard
# This script prevents commits if the codebase is in a "FEVER" state.

echo "🛰️  JoyZoning Pre-commit Guard: Auditing Structural Integrity..."

# Run the audit script
npx ts-node src/scripts/joy-check.ts

AUDIT_RESULT=$?

if [ $AUDIT_RESULT -ne 0 ]; then
  echo "🚨 COMMIT REJECTED: Structural integrity compromised."
  echo "Remediation: Use 'diagnose_sovereignty' or 'decompose_sovereign_module' to identify and fix violations."
  exit 1
fi

echo "💎 Structural integrity verified. Proceeding with commit."
exit 0
