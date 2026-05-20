use anchor_lang::prelude::*;
use anchor_lang::system_program::System;
use anchor_spl::token::{
    Mint,
    Token,
    TokenAccount
};

use crate::state::*;

#[derive(Accounts)]
#[instruction(target_epoch: i64)]
pub struct SlashOperator<'info> {

    #[account(mut)]
    pub challenger: Signer<'info>,

    #[account(
        mut,
        token::mint = mint,
        token::authority = challenger
    )]
    pub challenger_token_account:
        Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        seeds = [
            b"operator",
            operator_record.authority.as_ref()
        ],
        bump
    )]
    pub operator_record:
        Box<Account<'info, OperatorRecord>>,

    #[account(
        mut,
        seeds = [
            b"vault",
            operator_record.authority.as_ref()
        ],
        bump
    )]
    pub vault:
        Box<Account<'info, TokenAccount>>,

    pub mint: Box<Account<'info, Mint>>,

    /// CHECK:
    /// Settlement program OperatorStats PDA
    /// OR System Program sentinel
    pub operator_stats:
        UncheckedAccount<'info>,

    #[account(
        init,
        payer = challenger,
        space = 8 + SlashRecord::SPACE,
        seeds = [
            b"slash",
            operator_record.authority.as_ref(),
            &target_epoch.to_le_bytes()
        ],
        bump
    )]
    pub slash_record:
        Account<'info, SlashRecord>,

    pub token_program:
        Program<'info, Token>,

    pub system_program:
        Program<'info, System>,
}