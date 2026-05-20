use anchor_lang::prelude::*;

pub mod constants;
pub mod contexts;
pub mod error;
pub mod instructions;
pub mod state;
pub mod utils;

pub use contexts::*;
pub use state::*;

declare_id!(
    "38X2K9cy8m4LnvtRmhFWs6TRuxCZV24znbBqCDJaAPXT"
);

#[program]
pub mod operator_registry {

    use super::*;

    pub fn register_operator(
        ctx: Context<RegisterOperator>,
        endpoint_url: String,
        region: String,
        stake_amount: u64,
    ) -> Result<()> {

        instructions::register_operator::handler(
            ctx,
            endpoint_url,
            region,
            stake_amount,
        )
    }

    pub fn deregister_operator(
        ctx: Context<DeregisterOperator>
    ) -> Result<()> {

        instructions::deregister_operator::handler(
            ctx
        )
    }

    pub fn slash_operator(
        ctx: Context<SlashOperator>,
        target_epoch: i64,
    ) -> Result<()> {

        instructions::slash_operator::handler(
            ctx,
            target_epoch
        )
    }
}