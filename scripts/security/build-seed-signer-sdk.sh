#!/usr/bin/env bash
# Build offline-testable same-seed signers. Does NOT authorize a production release.
set -euo pipefail
root=$(cd "$(dirname "$0")/../.." && pwd)
: "${SDK_WORKTREE:?Set SDK_WORKTREE to a clean scratch checkout of the pinned SDK}"
: "${WASM_BINDGEN:?Set WASM_BINDGEN to the verified wasm-bindgen 0.2.120 binary}"
source_commit=57c5b9e5f0749f97ffe5d93bce21c994f6957cf4
baseline_commit=d7b88b33defd4edc44d67060c9584093f9e5e97d
patch="$root/vendor/patches/0007-signer-storage-identity.patch"
test "$(git -C "$SDK_WORKTREE" rev-parse HEAD)" = "$source_commit"
test "$(rustc --version | awk '{print $2}')" = 1.95.0
test "$("$WASM_BINDGEN" --version)" = 'wasm-bindgen 0.2.120'
sdk_wasm_test_runner="$(dirname "$WASM_BINDGEN")/wasm-bindgen-test-runner"
test "$("$sdk_wasm_test_runner" --version)" = 'wasm-bindgen-test-runner 0.2.120'
node --version
"$sdk_wasm_test_runner" --version
python3 "$root/scripts/security/check-sdk-source.py" --source "$SDK_WORKTREE" --require-clean
git -C "$SDK_WORKTREE" apply --check "$patch"
git -C "$SDK_WORKTREE" apply "$patch"
python3 "$root/scripts/security/check-sdk-source.py" --source "$SDK_WORKTREE" --patch "$patch"
cd "$SDK_WORKTREE"
export CARGO_BUILD_JOBS=${CARGO_BUILD_JOBS:-2}
export CARGO_PROFILE_TEST_DEBUG=0 CARGO_PROFILE_DEV_DEBUG=0
export CC_wasm32_unknown_unknown=${CC_wasm32_unknown_unknown:-clang}
export AR_wasm32_unknown_unknown=${AR_wasm32_unknown_unknown:-llvm-ar}
rust_gate() {
 local sdk_crate="$1" sdk_filter="$2" sdk_gate_log
 shift 2
 sdk_gate_log=$(mktemp /tmp/gys-sdk-gate-XXXXXX.log)
 if ! cargo test --locked -p "$sdk_crate" "$sdk_filter" --lib "$@" 2>&1 | tee "$sdk_gate_log"; then
  rm -f "$sdk_gate_log"
  return 1
 fi
 python3 - "$sdk_gate_log" "$sdk_crate" "$sdk_filter" <<'PY'
import json, re, sys
from pathlib import Path
text = Path(sys.argv[1]).read_text()
summaries = re.findall(r'test result: ok\. (\d+) passed; (\d+) failed;', text)
if len(summaries) != 1 or int(summaries[0][0]) == 0 or int(summaries[0][1]) != 0:
    raise SystemExit('Required Rust gate did not run a nonzero passing test set: ' + sys.argv[3])
print(json.dumps({'rustGate': sys.argv[3], 'crate': sys.argv[2], 'passed': int(summaries[0][0])}))
PY
 rm -f "$sdk_gate_log"
}
rust_gate breez-sdk-spark seed_factory
rust_gate breez-sdk-spark sdk::observation::tests::
rust_gate breez-sdk-spark signed_recovery_
rust_gate breez-sdk-spark incoming_claim_
rust_gate breez-sdk-spark mature_deposit_
rust_gate breez-sdk-spark outspend_
rust_gate breez-sdk-spark incoming_lightning_
rust_gate breez-sdk-spark sdk::unilateral_exit::tests::
rust_gate breez-sdk-spark signer::single_key_signer::tests::
rust_gate breez-sdk-spark sdk::attempt_store::tests::
rust_gate breez-sdk-spark cached_item_compare_and_swap_
rust_gate spark strict_transfer_
rust_gate spark strict_htlc_
rust_gate spark-wallet wallet::deposit_observation::tests::
rust_gate spark-wallet wallet::direct_observation::tests::
rust_gate spark-wallet wallet::incoming_lightning::tests::
# Run the actual Rust/JavaScript storage ABI using the pinned WASM runner.
# This feature selects disconnected test fixtures only; release compilation
# below does not enable it and contains no fixture exports.
export CARGO_TARGET_WASM32_UNKNOWN_UNKNOWN_RUNNER="$sdk_wasm_test_runner"
rust_gate breez-sdk-spark-wasm storage_cas_bridge_ --release --target wasm32-unknown-unknown --features storage-cas-tests
rust_gate breez-sdk-spark-wasm storage_identity_ --release --target wasm32-unknown-unknown --features storage-cas-tests
cargo build --locked -p breez-sdk-spark-wasm --target wasm32-unknown-unknown --release
python3 "$root/scripts/security/check-sdk-source.py" --source "$SDK_WORKTREE" --patch "$patch"
baseline=$(mktemp)
trap 'rm -f "$baseline"' EXIT
git -C "$root" show "$baseline_commit:vendor/breeztech-breez-sdk-spark.tgz" > "$baseline"
python3 "$root/scripts/security/package-seed-signer-sdk.py" \
 --source "$SDK_WORKTREE" --baseline "$baseline" \
 --wasm "${CARGO_TARGET_DIR:-$SDK_WORKTREE/target}/wasm32-unknown-unknown/release/breez_sdk_spark_wasm.wasm" \
 --bindgen "$WASM_BINDGEN" --patch "$patch" \
 --output "$root/vendor/breeztech-breez-sdk-spark.tgz"
