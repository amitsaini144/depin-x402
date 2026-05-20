use anchor_lang::prelude::*;

#[account]
pub struct SlashRecord {
    pub operator: Pubkey,
    pub epoch: i64,
    pub challenger: Pubkey,
    pub slash_amount: u64,
    pub slashed_at: i64,
}

impl SlashRecord {
    pub const SPACE: usize = 32 + 8 + 32 + 8 + 8;
}