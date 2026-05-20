use anchor_lang::prelude::*;
use crate::error::RegistryError;

#[derive(Debug)]
pub struct OperatorStatsData {
    pub operator: Pubkey,
    pub epoch: i64,
    pub payment_count: u64,
    pub volume: u64,
    pub rewards_claimed: bool,
}

pub fn deserialize_operator_stats(
    account: &AccountInfo
) -> Result<OperatorStatsData> {

    let data = account.try_borrow_data()?;

    let payload = &data[8..];

    require!(
        payload.len() >= 57,
        RegistryError::InvalidStatsPda
    );

    Ok(OperatorStatsData {
        operator: Pubkey::try_from(&payload[0..32]).unwrap(),
        epoch: i64::from_le_bytes(payload[32..40].try_into().unwrap()),
        payment_count: u64::from_le_bytes(payload[40..48].try_into().unwrap()),
        volume: u64::from_le_bytes(payload[48..56].try_into().unwrap()),
        rewards_claimed: payload[56] != 0,
    })
}