#!/bin/bash
# Dedicated runner for self-contained Google Personal provider tests

echo "🚀 Running self-contained comprehensive tests for Google Personal provider..."

# Use tsx with mocha directly. 
# We don't require src/test/requires.ts to avoid ESM/CJS dependency hell.
npx tsx ./node_modules/mocha/bin/mocha \
  --no-config \
  --reporter spec \
  src/test/google-personal/comprehensive.test.ts

RESULT=$?

if [ $RESULT -eq 0 ]; then
  echo "✅ All tests passed successfully!"
else
  echo "❌ Tests failed with exit code $RESULT"
fi

exit $RESULT
