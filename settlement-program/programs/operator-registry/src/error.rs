use anchor_lang::prelude::*;

#[error_code]
pub enum RegistryError {
    #[msg("Endpoint URL must be 128 characters or less")]
    UrlTooLong,

    #[msg("Stake amount is below minimum required")]
    InsufficientStake,

    #[msg("Operator is not active")]
    NotActive,

    #[msg("Epoch is not yet complete")]
    EpochNotComplete,

    #[msg("Operator had payments this epoch")]
    HasPayments,

    #[msg("Rewards already claimed")]
    RewardsClaimed,

    #[msg("Already slashed")]
    AlreadySlashed,

    #[msg("Operator already registered")]
    AlreadyRegistered,

    #[msg("Invalid stats owner")]
    InvalidStatsOwner,

    #[msg("Invalid stats PDA")]
    InvalidStatsPda,

    #[msg("Vault empty")]
    EmptyVault,

    #[msg("Epoch mismatch")]
    EpochMismatch,
}