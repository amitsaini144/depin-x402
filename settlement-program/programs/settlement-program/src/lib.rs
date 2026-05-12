use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer, MintTo};

declare_id!("Hzg2MGHMMoVDgA5X5v5r4XwMKyZAwUyZuYfMAtUg6whV");

pub const EPOCH_DURATION:       i64 = 60;
const REWARD_TOKENS_PER_TX:     u64 = 1_000_000;

// ─── Errors ──────────────────────────────────────────────────────────────────

#[error_code]
pub enum SettlementError {
    #[msg("Rewards already claimed for this epoch")]
    AlreadyClaimed,
    #[msg("Epoch is not yet complete")]
    EpochNotComplete,
}

// ─── Program ─────────────────────────────────────────────────────────────────

#[program]
pub mod settlement_program {
    use super::*;

    pub fn initialize_protocol(ctx: Context<InitializeProtocol>) -> Result<()> {
        msg!("Protocol initialized. Reward mint: {}", ctx.accounts.reward_mint.key());
        Ok(())
    }

    pub fn settle_payment(
        ctx: Context<SettlePayment>,
        amount: u64,
        resource_hash: [u8; 32],
        nonce: [u8; 8],
    ) -> Result<()> {
        // Transfer USDC from payer to merchant
        let cpi_accounts = Transfer {
            from:      ctx.accounts.payer_ata.to_account_info(),
            to:        ctx.accounts.merchant_ata.to_account_info(),
            authority: ctx.accounts.payer.to_account_info(),
        };
        token::transfer(
            CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts),
            amount,
        )?;

        // Write payment receipt
        let receipt = &mut ctx.accounts.payment_receipt;
        receipt.payer         = ctx.accounts.payer.key();
        receipt.merchant      = ctx.accounts.merchant_ata.key();
        receipt.amount        = amount;
        receipt.resource_hash = resource_hash;
        receipt.nonce         = nonce;
        receipt.timestamp     = Clock::get()?.unix_timestamp;
        receipt.settled       = true;

        // Update epoch-keyed OperatorStats.
        //
        // IMPORTANT: OperatorStats is now keyed by [b"stats", operator, epoch_bytes].
        // Each epoch gets its own PDA — historical data is never overwritten.
        // This allows the slasher to read any past epoch's stats without a race condition.
        let now           = Clock::get()?.unix_timestamp;
        let current_epoch = now / EPOCH_DURATION;
        let stats         = &mut ctx.accounts.operator_stats;

        // On first write to this epoch PDA, initialize it
        if stats.epoch == 0 && stats.payment_count == 0 {
            stats.operator        = ctx.accounts.operator.key();
            stats.epoch           = current_epoch;
            stats.payment_count   = 0;
            stats.volume          = 0;
            stats.rewards_claimed = false;
        }

        stats.payment_count += 1;
        stats.volume        += amount;

        Ok(())
    }

    pub fn claim_rewards(ctx: Context<ClaimRewards>, epoch: i64) -> Result<()> {
        let now           = Clock::get()?.unix_timestamp;
        let current_epoch = now / EPOCH_DURATION;
        let stats         = &mut ctx.accounts.operator_stats;

        require!(epoch < current_epoch,   SettlementError::EpochNotComplete);
        require!(!stats.rewards_claimed,  SettlementError::AlreadyClaimed);

        let reward_amount = stats.payment_count.saturating_mul(REWARD_TOKENS_PER_TX);

        stats.rewards_claimed = true;

        let seeds        = &[b"reward-authority".as_ref(), &[ctx.bumps.reward_authority]];
        let signer_seeds = &[&seeds[..]];

        let cpi_accounts = MintTo {
            mint:      ctx.accounts.reward_mint.to_account_info(),
            to:        ctx.accounts.operator_reward_ata.to_account_info(),
            authority: ctx.accounts.reward_authority.to_account_info(),
        };
        token::mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                cpi_accounts,
                signer_seeds,
            ),
            reward_amount,
        )?;

        Ok(())
    }
}

// ─── Account contexts ─────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct InitializeProtocol<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        init,
        payer = payer,
        mint::decimals  = 6,
        mint::authority = reward_authority,
        seeds = [b"reward-mint"],
        bump,
    )]
    pub reward_mint: Account<'info, Mint>,

    /// CHECK: PDA used only as mint authority
    #[account(
        seeds = [b"reward-authority"],
        bump,
    )]
    pub reward_authority: UncheckedAccount<'info>,

    pub token_program:  Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent:           Sysvar<'info, Rent>,
}

#[derive(Accounts)]
#[instruction(amount: u64, resource_hash: [u8; 32], nonce: [u8; 8])]
pub struct SettlePayment<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(mut)]
    pub payer_ata: Account<'info, TokenAccount>,

    #[account(mut)]
    pub merchant_ata: Account<'info, TokenAccount>,

    #[account(
        init,
        payer = payer,
        space = 8 + PaymentReceipt::SPACE,
        seeds = [b"receipt", payer.key().as_ref(), &nonce],
        bump,
    )]
    pub payment_receipt: Account<'info, PaymentReceipt>,

    /// CHECK: used only as seed for operator_stats PDA
    pub operator: UncheckedAccount<'info>,

    #[account(
        init_if_needed,
        payer = payer,
        space = 8 + OperatorStats::SPACE,
        // KEY CHANGE: epoch is now part of the PDA seed.
        // Each epoch gets its own account — history is preserved.
        seeds = [
            b"stats",
            operator.key().as_ref(),
            &(Clock::get().unwrap().unix_timestamp / EPOCH_DURATION).to_le_bytes(),
        ],
        bump,
    )]
    pub operator_stats: Account<'info, OperatorStats>,

    pub token_program:  Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(epoch: i64)]
pub struct ClaimRewards<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [
            b"stats",
            authority.key().as_ref(),
            &epoch.to_le_bytes(),
        ],
        bump,
        constraint = operator_stats.epoch == epoch @ SettlementError::EpochNotComplete,
    )]
    pub operator_stats: Account<'info, OperatorStats>,

    #[account(
        mut,
        seeds = [b"reward-mint"],
        bump,
    )]
    pub reward_mint: Account<'info, Mint>,

    /// CHECK: PDA used only as signer for mint_to
    #[account(
        seeds = [b"reward-authority"],
        bump,
    )]
    pub reward_authority: UncheckedAccount<'info>,

    #[account(
        mut,
        token::mint      = reward_mint,
        token::authority = authority,
    )]
    pub operator_reward_ata: Account<'info, TokenAccount>,

    pub token_program:  Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

// ─── State ────────────────────────────────────────────────────────────────────

#[account]
pub struct PaymentReceipt {
    pub payer:         Pubkey,
    pub merchant:      Pubkey,
    pub amount:        u64,
    pub resource_hash: [u8; 32],
    pub nonce:         [u8; 8],
    pub timestamp:     i64,
    pub settled:       bool,
}

impl PaymentReceipt {
    pub const SPACE: usize = 32 + 32 + 8 + 32 + 8 + 8 + 1;
}

#[account]
pub struct OperatorStats {
    pub operator:        Pubkey,
    pub epoch:           i64,
    pub payment_count:   u64,
    pub volume:          u64,
    pub rewards_claimed: bool,
}

impl OperatorStats {
    pub const SPACE: usize = 32 + 8 + 8 + 8 + 1; // 57 bytes
}