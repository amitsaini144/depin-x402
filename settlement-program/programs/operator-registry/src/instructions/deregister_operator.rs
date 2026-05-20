use anchor_lang::prelude::*;
use anchor_spl::token::{
    self,
    Transfer,
};

use crate::{
    contexts::*,
    error::*,
};

pub fn handler(
    ctx: Context<DeregisterOperator>
) -> Result<()> {

    let op = &mut ctx.accounts.operator_record;

    require!(
        op.active,
        RegistryError::NotActive
    );

    op.active = false;

    let authority_key =
        ctx.accounts.authority.key();

    let seeds = &[
        b"vault",
        authority_key.as_ref(),
        &[ctx.bumps.vault]
    ];

    let signer_seeds = &[&seeds[..]];

    let cpi_accounts = Transfer {
        from: ctx
            .accounts
            .vault
            .to_account_info(),

        to: ctx
            .accounts
            .operator_token_account
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
        op.stake,
    )?;

    op.stake = 0;

    Ok(())
}