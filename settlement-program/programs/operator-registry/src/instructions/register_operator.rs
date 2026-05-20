use anchor_lang::prelude::*;
use anchor_spl::token::{
    self,
    Transfer,
};

use crate::{
    constants::*,
    contexts::*,
    error::*,
};

pub fn handler(
    ctx: Context<RegisterOperator>,
    endpoint_url: String,
    region: String,
    stake_amount: u64,
) -> Result<()> {

    require!(
        endpoint_url.len() <= 128,
        RegistryError::UrlTooLong
    );

    require!(
        stake_amount >= MIN_STAKE,
        RegistryError::InsufficientStake
    );

    let op = &ctx.accounts.operator_record;

    if op.registered_at != 0 {
        require!(
            !op.active,
            RegistryError::AlreadyRegistered
        );
    }

    let cpi_accounts = Transfer {
        from: ctx
            .accounts
            .operator_token_account
            .to_account_info(),

        to: ctx
            .accounts
            .vault
            .to_account_info(),

        authority: ctx
            .accounts
            .authority
            .to_account_info(),
    };

    token::transfer(
        CpiContext::new(
            ctx.accounts
                .token_program
                .to_account_info(),
            cpi_accounts,
        ),
        stake_amount,
    )?;

    let op = &mut ctx.accounts.operator_record;

    op.authority = ctx.accounts.authority.key();
    op.endpoint_url = endpoint_url;
    op.region = region;
    op.stake = stake_amount;
    op.registered_at = Clock::get()?.unix_timestamp;
    op.active = true;
    op.total_volume = 0;
    op.score = 0;

    Ok(())
}