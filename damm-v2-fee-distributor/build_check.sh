#!/bin/bash

# Simple build check script
cd /workspace/damm-v2-fee-distributor/programs/damm-v2-fee-distributor

echo "Checking Rust syntax..."
if cargo check --message-format=short 2>&1 | grep -q "error:"; then
    echo "❌ Compilation errors found:"
    cargo check --message-format=short 2>&1 | grep "error:"
    exit 1
else
    echo "✅ No compilation errors found"
    exit 0
fi