#!/usr/bin/env python3
"""Apply the reviewed recovery extension to a scratch SDK after cumulative patch 0002.
Does not connect a wallet, sign with user material or broadcast a transaction.
"""
from pathlib import Path
import sys
root=Path(sys.argv[1])
def replace(path, old, new):
    p=root/path; text=p.read_text()
    if text.count(old)!=1: raise RuntimeError(f'Unexpected source in {path}: {old[:70]}')
    p.write_text(text.replace(old,new))
path='crates/breez-sdk/core/src/sdk/deposits.rs'
p=root/path; text=p.read_text()
start=text.index('    pub async fn refund_deposit(')
stop=text.index('        let broadcast_error =',start)
method=text[start:stop]
method=method.replace('pub async fn refund_deposit(', 'pub async fn sign_refund_deposit(',1)
method=method.replace('        let detailed_utxo =', '''        if !matches!(request.fee, Fee::Fixed { .. }) {
            return Err(SdkError::InvalidInput("A fixed refund fee is required".to_string()));
        }
        let detailed_utxo =''',1)
anchor='        // Nothing stored means no refund to outbid.'
assert anchor in method
method=method.replace(anchor,'''        // This API is single-signing, never an implicit RBF/replacement request.
        if existing.as_ref().is_some_and(|d| d.refund_tx.is_some()) {
            return Err(SdkError::InvalidInput("A signed refund already exists; resume it without signing again".to_string()));
        }
        let _claim_guard = self.claim_guards.try_acquire(TxOutput {
            txid: detailed_utxo.txid.to_string(), vout: detailed_utxo.vout,
        }).ok_or_else(|| SdkError::InvalidInput("This deposit is already being processed".to_string()))?;
'''+anchor)
method=method.replace('let tx_id = tx.compute_txid().as_raw_hash().to_string();','let tx_id = tx.compute_txid().to_string();')
method+='''        // Signed bytes are durable inside the SDK before they leave this API.
        // The application must validate, journal and separately authorize broadcast.
        Ok(RefundDepositResponse { tx_id, tx_hex })
    }

'''
text=text[:start]+method+text[start:]
p.write_text(text)
replace('crates/breez-sdk/core/src/sdk/mod.rs','mod deposits;','mod deposits;\nmod signed_recovery;')
models='''
/// Validates a refund against the exact source, destination, amount and fixed fee.
#[derive(Debug, Clone)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct VerifyRefundTransactionRequest {
    pub refund: RefundDepositRequest,
    pub tx_id: String,
    pub tx_hex: String,
    pub expected_amount_sats: u64,
}
#[derive(Debug, Clone)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct InspectRecoveryTransactionRequest { pub tx_hex: String }
#[derive(Debug, Clone)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct InspectedRecoveryOutput {
    pub value_sats: u64,
    pub script_hex: String,
    pub address: Option<String>,
}
#[derive(Debug, Clone)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct InspectRecoveryTransactionResponse {
    pub tx_id: String,
    pub input_outpoints: Vec<String>,
    pub outputs: Vec<InspectedRecoveryOutput>,
}
'''
p=root/'crates/breez-sdk/core/src/models/mod.rs'; p.write_text(p.read_text()+models)
wasm_models='''
#[macros::extern_wasm_bindgen(breez_sdk_spark::VerifyRefundTransactionRequest)]
pub struct VerifyRefundTransactionRequest {
    pub refund: RefundDepositRequest,
    pub tx_id: String,
    pub tx_hex: String,
    pub expected_amount_sats: u64,
}
#[macros::extern_wasm_bindgen(breez_sdk_spark::InspectRecoveryTransactionRequest)]
pub struct InspectRecoveryTransactionRequest { pub tx_hex: String }
#[macros::extern_wasm_bindgen(breez_sdk_spark::InspectedRecoveryOutput)]
pub struct InspectedRecoveryOutput {
    pub value_sats: u64,
    pub script_hex: String,
    pub address: Option<String>,
}
#[macros::extern_wasm_bindgen(breez_sdk_spark::InspectRecoveryTransactionResponse)]
pub struct InspectRecoveryTransactionResponse {
    pub tx_id: String,
    pub input_outpoints: Vec<String>,
    pub outputs: Vec<InspectedRecoveryOutput>,
}
'''
p=root/'crates/breez-sdk/wasm/src/models/mod.rs';p.write_text(p.read_text()+wasm_models)
replace('crates/breez-sdk/wasm/src/sdk.rs','    #[wasm_bindgen(js_name = "claimDeposit")]', '''    #[wasm_bindgen(js_name = "signRefundDeposit")]
    pub async fn sign_refund_deposit(&self, request: RefundDepositRequest) -> WasmResult<RefundDepositResponse> {
        Ok(self.sdk.sign_refund_deposit(request.into()).await?.into())
    }
    #[wasm_bindgen(js_name = "verifyRefundTransaction")]
    pub async fn verify_refund_transaction(&self, request: VerifyRefundTransactionRequest) -> WasmResult<RefundDepositResponse> {
        Ok(self.sdk.verify_refund_transaction(request.into()).await?.into())
    }
    #[wasm_bindgen(js_name = "inspectRecoveryTransaction")]
    pub fn inspect_recovery_transaction(&self, request: InspectRecoveryTransactionRequest) -> WasmResult<InspectRecoveryTransactionResponse> {
        Ok(self.sdk.inspect_recovery_transaction(request.into())?.into())
    }

    #[wasm_bindgen(js_name = "claimDeposit")]''')
source=r'''use std::str::FromStr;
use bitcoin::{Address, Transaction, Txid, Script, consensus::encode::deserialize_hex, hex::DisplayHex};
use crate::{SdkError, Fee, RefundDepositResponse, VerifyRefundTransactionRequest,
    InspectRecoveryTransactionRequest, InspectRecoveryTransactionResponse, InspectedRecoveryOutput,
    utils::utxo_fetcher::CachedUtxoFetcher};
use super::BreezSdk;

fn invalid(message: &str) -> SdkError { SdkError::InvalidInput(message.to_string()) }
fn parse_transaction(hex: &str) -> Result<Transaction, SdkError> {
    if hex.is_empty() || hex.len()>8_000_000 || hex.len()%2!=0 {
        return Err(invalid("Invalid recovery transaction size"));
    }
    deserialize_hex(hex).map_err(|_| invalid("Invalid recovery transaction encoding"))
}
fn verify_refund_envelope(tx: &Transaction, source: Txid, vout: u32, value: u64,
    destination: &Script, fee: u64, expected_txid: &str) -> Result<(), SdkError> {
    if tx.compute_txid().to_string()!=expected_txid.to_lowercase() || tx.input.len()!=1 ||
        tx.input[0].previous_output.txid!=source || tx.input[0].previous_output.vout!=vout ||
        tx.output.len()!=1 || tx.output[0].script_pubkey.as_script()!=destination ||
        value.checked_sub(tx.output[0].value.to_sat())!=Some(fee) ||
        tx.output[0].value.to_sat()==0 ||
        (tx.input[0].witness.is_empty() && tx.input[0].script_sig.is_empty()) {
        return Err(invalid("Signed refund differs from the authorized source, destination or fee"));
    }
    Ok(())
}

#[macros::instance_span]
#[cfg_attr(feature = "uniffi", uniffi::export(async_runtime = "tokio"))]
impl BreezSdk {
    /// Observation and envelope validation only: no signing, claims or broadcasts.
    pub async fn verify_refund_transaction(&self, request: VerifyRefundTransactionRequest) -> Result<RefundDepositResponse,SdkError> {
        let fee=match request.refund.fee {Fee::Fixed{amount}=>amount,_=>return Err(invalid("A fixed refund fee is required"))};
        let destination=Address::from_str(&request.refund.destination_address)
            .map_err(|_|invalid("Invalid refund destination"))?
            .require_network(bitcoin::Network::from(self.config.network))
            .map_err(|_|invalid("Refund destination network mismatch"))?;
        let utxo=CachedUtxoFetcher::new(self.chain_service.clone(),self.storage.clone())
            .fetch_detailed_utxo(&request.refund.txid,request.refund.vout).await?;
        if utxo.value!=request.expected_amount_sats {return Err(invalid("Refund source value changed"));}
        let tx=parse_transaction(&request.tx_hex)?;
        verify_refund_envelope(&tx,utxo.txid,utxo.vout,utxo.value,
            destination.script_pubkey().as_script(),fee,&request.tx_id)?;
        Ok(RefundDepositResponse{tx_id:tx.compute_txid().to_string(),tx_hex:request.tx_hex})
    }
    /// Decode an already signed plan without granting any signing capability.
    /// This verifies serialization and transaction identity, not consensus signatures.
    pub fn inspect_recovery_transaction(&self, request: InspectRecoveryTransactionRequest) -> Result<InspectRecoveryTransactionResponse,SdkError> {
        let tx=parse_transaction(&request.tx_hex)?;
        let network=bitcoin::Network::from(self.config.network);
        Ok(InspectRecoveryTransactionResponse {
            tx_id:tx.compute_txid().to_string(),
            input_outpoints:tx.input.iter().map(|i|i.previous_output.to_string()).collect(),
            outputs:tx.output.iter().map(|o|InspectedRecoveryOutput {
                value_sats:o.value.to_sat(), script_hex:o.script_pubkey.as_bytes().as_hex().to_string(),
                address:Address::from_script(&o.script_pubkey,network).ok().map(|a|a.to_string()),
            }).collect(),
        })
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use bitcoin::{Amount, OutPoint, TxIn, TxOut, Witness, ScriptBuf, Sequence, absolute::LockTime, transaction::Version, hashes::Hash};
    fn tx()->Transaction {
        Transaction {version:Version::TWO,lock_time:LockTime::ZERO,
            input:vec![TxIn {previous_output:OutPoint{txid:Txid::all_zeros(),vout:1},
                script_sig:ScriptBuf::new(),sequence:Sequence::MAX,witness:Witness::from_slice(&[vec![1u8;64]])}],
            output:vec![TxOut{value:Amount::from_sat(900),script_pubkey:ScriptBuf::new()}]}
    }
    fn verify(t:&Transaction)->Result<(),SdkError>{verify_refund_envelope(t,Txid::all_zeros(),1,1000,Script::new(),100,&t.compute_txid().to_string())}
    #[test] fn signed_recovery_exact_refund_envelope(){assert!(verify(&tx()).is_ok());}
    #[test] fn signed_recovery_wrong_outpoint(){let mut t=tx();t.input[0].previous_output.vout=2;assert!(verify(&t).is_err());}
    #[test] fn signed_recovery_wrong_fee(){let mut t=tx();t.output[0].value=Amount::from_sat(899);assert!(verify(&t).is_err());}
    #[test] fn signed_recovery_extra_output(){let mut t=tx();t.output.push(t.output[0].clone());assert!(verify(&t).is_err());}
    #[test] fn signed_recovery_unsigned(){let mut t=tx();t.input[0].witness=Witness::new();assert!(verify(&t).is_err());}
    #[test] fn signed_recovery_mismatched_txid(){let t=tx();assert!(verify_refund_envelope(&t,Txid::all_zeros(),1,1000,Script::new(),100,&"11".repeat(32)).is_err());}
    #[test] fn signed_recovery_changed_destination(){let mut t=tx();t.output[0].script_pubkey=ScriptBuf::from_bytes(vec![0x51]);assert!(verify(&t).is_err());}
    #[test] fn signed_recovery_malformed_encoding(){for s in ["","00","abcd","zz"]{assert!(parse_transaction(s).is_err());}}
}
'''
(root/'crates/breez-sdk/core/src/sdk/signed_recovery.rs').write_text(source)
print('Recovery SDK source extension applied; compilation and tests still required.')
