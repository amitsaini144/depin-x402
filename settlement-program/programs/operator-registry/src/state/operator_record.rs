use anchor_lang::prelude::*;

#[account]
pub struct OperatorRecord {
    pub authority: Pubkey,
    pub endpoint_url: String,
    pub region: String,
    pub stake: u64,
    pub registered_at: i64,
    pub active: bool,
    pub total_volume: u64,
    pub score: u64,
}

impl OperatorRecord {
    pub const SPACE: usize =
        32 +
        (4 + 128) +
        (4 + 32) +
        8 +
        8 +
        1 +
        8 +
        8;
}