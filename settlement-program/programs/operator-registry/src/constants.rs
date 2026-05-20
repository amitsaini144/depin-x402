use anchor_lang::prelude::*;

pub const MIN_STAKE: u64 = 1_000_000;
pub const SLASH_BPS: u64 = 1000;
pub const EPOCH_DURATION: i64 = 60;

pub const SETTLEMENT_PROGRAM_ID: Pubkey =
    pubkey!("Hzg2MGHMMoVDgA5X5v5r4XwMKyZAwUyZuYfMAtUg6whV");