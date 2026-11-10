#!/usr/bin/env bash
# Checks that cover easy mode and the classic files it hooks into.
# Run from the repository root after dependencies are installed (pnpm install).
set -euo pipefail

node node_modules/vitest/vitest.mjs run \
    src/ts/easyMode \
    src/lib/ChatScreens \
    src/lib/UI/GUI/SkinPartContract.test.ts \
    src/lib/UI/GUI/SkinShapeContract.test.ts \
    src/lib/UI/GUI/RawUiColors.test.ts \
    src/lib/UI/GUI/ThemeTokenContract.test.ts \
    src/App.fileDropImport.test.ts \
    scripts/check-brand-boundary.test.ts

pnpm check
