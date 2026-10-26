#!/usr/bin/env bash
# Build offline-testable same-seed signers. Does NOT authorize a production release.
set -euo pipefail
root=$(cd "$(dirname "$0")/../.." && pwd)
: "${SDK_WORKTREE:?Set SDK_WORKTREE to a clean scratch checkout of the pinned SDK}"
: "${WASM_BINDGEN:?Set WASM_BINDGEN to the verified wasm-bindgen 0.2.120 binary}"
source_commit=57c5b9e5f0749f97ffe5d93bce21c994f6957cf4
baseline_commit=d7b88b33defd4edc44d67060c9584093f9e5e97d
patch="$root/vendor/patches/0004-complete-signed-recovery-source.patch"
test "$(git -C "$SDK_WORKTREE" rev-parse HEAD)" = "$source_commit"
test "$(rustc --version | awk '{print $2}')" = 1.95.0
test "$("$WASM_BINDGEN" --version)" = 'wasm-bindgen 0.2.120'
git -C "$SDK_WORKTREE" diff --quiet
git -C "$SDK_WORKTREE" apply --check "$patch"
git -C "$SDK_WORKTREE" apply "$patch"
python3 "$root/scripts/security/check-sdk-source.py" --source "$SDK_WORKTREE" --patch "$patch"
cd "$SDK_WORKTREE"
export CARGO_BUILD_JOBS=${CARGO_BUILD_JOBS:-2}
export CARGO_PROFILE_TEST_DEBUG=0 CARGO_PROFILE_DEV_DEBUG=0
export CC_wasm32_unknown_unknown=${CC_wasm32_unknown_unknown:-clang}
export AR_wasm32_unknown_unknown=${AR_wasm32_unknown_unknown:-llvm-ar}
cargo test --locked -p breez-sdk-spark seed_factory --lib
cargo test --locked -p breez-sdk-spark observation_ --lib
cargo test --locked -p breez-sdk-spark signed_recovery_ --lib
cargo test --locked -p breez-sdk-spark incoming_claim_ --lib
cargo build --locked -p breez-sdk-spark-wasm --target wasm32-unknown-unknown --release
baseline=$(mktemp)
trap 'rm -f "$baseline"' EXIT
git -C "$root" show "$baseline_commit:vendor/breeztech-breez-sdk-spark.tgz" > "$baseline"
python3 "$root/scripts/security/package-seed-signer-sdk.py" \
 --source "$SDK_WORKTREE" --baseline "$baseline" \
 --wasm "$SDK_WORKTREE/target/wasm32-unknown-unknown/release/breez_sdk_spark_wasm.wasm" \
 --bindgen "$WASM_BINDGEN" --patch "$patch" \
 --output "$root/vendor/breeztech-breez-sdk-spark.tgz"
