use anchor_lang::prelude::*;
use anchor_spl::token::{
    self,
    Transfer
};

use crate::{
    constants::*,
    contexts::*,
    error::*,
    utils::*,
};

pub fn handler(
    ctx: Context<SlashOperator>,
    target_epoch: i64,
) -> Result<()> {

    let now =
        Clock::get()?.unix_timestamp;

    let current_epoch =
        now / EPOCH_DURATION;

    require!(
        target_epoch < current_epoch,
        RegistryError::EpochNotComplete
    );

    let operator_key =
        ctx.accounts
            .operator_record
            .authority;

    let stats_key =
        ctx.accounts.operator_stats.key();

    if stats_key != System::id() {

        let stats_info =
            ctx.accounts
                .operator_stats
                .to_account_info();

        require!(
            stats_info.owner
                == &SETTLEMENT_PROGRAM_ID,
            RegistryError::InvalidStatsOwner
        );

        let epoch_bytes =
            target_epoch.to_le_bytes();

        let (
            expected_stats_pda,
            _
        ) = Pubkey::find_program_address(
            &[
                b"stats",
                operator_key.as_ref(),
                &epoch_bytes
            ],
            &SETTLEMENT_PROGRAM_ID
        );

        require!(
            stats_info.key()
                == expected_stats_pda,
            RegistryError::InvalidStatsPda
        );

        let stats =
            deserialize_operator_stats(
                &stats_info
            )?;

        require!(
            stats.epoch == target_epoch,
            RegistryError::EpochMismatch
        );

        require!(
            stats.payment_count == 0,
            RegistryError::HasPayments
        );

        require!(
            !stats.rewards_claimed,
            RegistryError::RewardsClaimed
        );

    }

    require!(
        ctx.accounts
            .operator_record
            .active,
        RegistryError::NotActive
    );

    let vault_balance =
        ctx.accounts.vault.amount;

    require!(
        vault_balance > 0,
        RegistryError::EmptyVault
    );

    let slash_amount =
        vault_balance
            .saturating_mul(SLASH_BPS)
            .saturating_div(10000);

    require!(
        slash_amount > 0,
        RegistryError::EmptyVault
    );

    let record =
        &mut ctx.accounts.slash_record;

    record.operator =
        operator_key;

    record.epoch =
        target_epoch;

    record.challenger =
        ctx.accounts.challenger.key();

    record.slash_amount =
        slash_amount;

    record.slashed_at =
        now;

    ctx.accounts.operator_record.stake =
        ctx.accounts
            .operator_record
            .stake
            .saturating_sub(
                slash_amount
            );

    let authority_key =
        operator_key;

    let seeds = &[
        b"vault",
        authority_key.as_ref(),
        &[ctx.bumps.vault]
    ];

    let signer_seeds =
        &[&seeds[..]];

    let cpi_accounts = Transfer {
        from: ctx
            .accounts
            .vault
            .to_account_info(),

        to: ctx
            .accounts
            .challenger_token_account
            .to_account_info(),

        authority: ctx
            .accounts
            .vault
            .to_account_info(),
    };

    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts
                .token_program
                .to_account_info(),
            cpi_accounts,
            signer_seeds,
        ),
        slash_amount,
    )?;

    msg!(
        "Operator {} slashed",
        operator_key
    );

    Ok(())
}