use anchor_lang::prelude::*;
use anchor_spl::token::{
    Token,
    TokenAccount
};

use crate::state::*;

#[derive(Accounts)]
pub struct DeregisterOperator<'info> {

    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [
            b"operator",
            authority.key().as_ref()
        ],
        bump,
        has_one = authority
    )]
    pub operator_record:
        Box<Account<'info, OperatorRecord>>,

    #[account(
        mut,
        seeds = [
            b"vault",
            authority.key().as_ref()
        ],
        bump
    )]
    pub vault:
        Box<Account<'info, TokenAccount>>,

    #[account(mut)]
    pub operator_token_account:
        Box<Account<'info, TokenAccount>>,

    pub token_program:
        Program<'info, Token>,
}