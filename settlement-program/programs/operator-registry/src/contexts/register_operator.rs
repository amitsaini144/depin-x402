use anchor_lang::prelude::*;
use anchor_lang::system_program::System;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::state::*;

#[derive(Accounts)]
#[instruction(
    endpoint_url: String,
    region: String,
    stake_amount: u64
)]
pub struct RegisterOperator<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(mut)]
    pub operator_token_account: Box<Account<'info, TokenAccount>>,

    #[account(
        init_if_needed,
        payer = authority,
        token::mint = mint,
        token::authority = vault,
        seeds = [
            b"vault",
            authority.key().as_ref()
        ],
        bump,
    )]
    pub vault: Box<Account<'info, TokenAccount>>,

    pub mint: Box<Account<'info, Mint>>,

    #[account(
        init_if_needed,
        payer = authority,
        space = 8 + OperatorRecord::SPACE,
        seeds = [
            b"operator",
            authority.key().as_ref()
        ],
        bump,
    )]
    pub operator_record:
        Box<Account<'info, OperatorRecord>>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}