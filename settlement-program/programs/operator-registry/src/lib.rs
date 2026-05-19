use anchor_lang::prelude::*;
use anchor_lang::system_program::System; 
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

declare_id!("38X2K9cy8m4LnvtRmhFWs6TRuxCZV24znbBqCDJaAPXT");

// Settlement program ID — for verifying foreign OperatorStats account ownership
pub const SETTLEMENT_PROGRAM_ID: Pubkey =
    pubkey!("Hzg2MGHMMoVDgA5X5v5r4XwMKyZAwUyZuYfMAtUg6whV");

const MIN_STAKE:      u64 = 1_000_000;
const SLASH_BPS:      u64 = 1_000; // 10% in basis points (1000 / 10000)

// ─── Errors ──────────────────────────────────────────────────────────────────

#[error_code]
pub enum RegistryError {
    #[msg("Endpoint URL must be 128 characters or less")]
    UrlTooLong,
    #[msg("Stake amount is below minimum required")]
    InsufficientStake,
    #[msg("Operator is not active")]
    NotActive,
    #[msg("Epoch is not yet complete — cannot slash a live epoch")]
    EpochNotComplete,
    #[msg("Operator had payments this epoch — not slashable")]
    HasPayments,
    #[msg("Operator already claimed rewards — not slashable")]
    RewardsClaimed,
    #[msg("This epoch has already been slashed for this operator")]
    AlreadySlashed,
    #[msg("Operator is already registered and active — deregister first")]
    AlreadyRegistered,
    #[msg("OperatorStats account does not belong to settlement program")]
    InvalidStatsOwner,
    #[msg("OperatorStats PDA seeds do not match operator")]
    InvalidStatsPda,
    #[msg("Vault has no stake to slash")]
    EmptyVault,
    #[msg("OperatorStats epoch does not match the slash target epoch")]
    EpochMismatch,
}

// ─── Program ─────────────────────────────────────────────────────────────────

#[program]
pub mod operator_registry {
    use super::*;

    pub fn register_operator(
        ctx: Context<RegisterOperator>,
        endpoint_url: String,
        region: String,
        stake_amount: u64,
    ) -> Result<()> {
        require!(endpoint_url.len() <= 128, RegistryError::UrlTooLong);
        require!(stake_amount >= MIN_STAKE, RegistryError::InsufficientStake);

        // Prevent overwriting an active registration
        let op = &ctx.accounts.operator_record;
        if op.registered_at != 0 {
            require!(!op.active, RegistryError::AlreadyRegistered);
        }

        let cpi_accounts = Transfer {
            from:      ctx.accounts.operator_token_account.to_account_info(),
            to:        ctx.accounts.vault.to_account_info(),
            authority: ctx.accounts.authority.to_account_info(),
        };
        token::transfer(
            CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts),
            stake_amount,
        )?;

        let op = &mut ctx.accounts.operator_record;
        op.authority     = ctx.accounts.authority.key();
        op.endpoint_url  = endpoint_url;
        op.region        = region;
        op.stake         = stake_amount;
        op.registered_at = Clock::get()?.unix_timestamp;
        op.active        = true;
        op.total_volume  = 0;
        op.score         = 0;

        Ok(())
    }

    pub fn deregister_operator(ctx: Context<DeregisterOperator>) -> Result<()> {
        let op = &mut ctx.accounts.operator_record;
        require!(op.active, RegistryError::NotActive);

        op.active = false;

        let authority_key = ctx.accounts.authority.key();
        let seeds = &[
            b"vault",
            authority_key.as_ref(),
            &[ctx.bumps.vault],
        ];
        let signer_seeds = &[&seeds[..]];

        let cpi_accounts = Transfer {
            from:      ctx.accounts.vault.to_account_info(),
            to:        ctx.accounts.operator_token_account.to_account_info(),
            authority: ctx.accounts.vault.to_account_info(),
        };
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                cpi_accounts,
                signer_seeds,
            ),
            op.stake,
        )?;

        op.stake = 0;
        Ok(())
    }

    /// Slash an operator who was active but processed zero payments in a completed epoch.
    ///
    /// Proof is the operator's OperatorStats PDA from the settlement program.
    /// Challenger earns 10% of vault balance. 90% stays locked.
    /// A SlashRecord PDA is created to prevent replaying the same epoch.
    ///
    /// # Arguments
    /// * `target_epoch` — the epoch number being slashed (must be complete)
    pub fn slash_operator(
        ctx: Context<SlashOperator>,
        target_epoch: i64,
    ) -> Result<()> {
        let now           = Clock::get()?.unix_timestamp;
        let current_epoch = now / EPOCH_DURATION;

        // 1. Epoch must be fully completed
        require!(target_epoch < current_epoch, RegistryError::EpochNotComplete);

        let operator_key = ctx.accounts.operator_record.authority;

        // 2-7. Verify slashability via OperatorStats — two valid paths:
        //
        //   Path A (None): No stats PDA exists for this epoch.
        //                  Operator was completely invisible — never processed a payment.
        //                  Absence is proof. Slashable immediately.
        //
        //   Path B (Some): Stats PDA exists. Operator appeared on-chain but did zero work.
        //                  Verify: owner, seeds, epoch match, payment_count == 0, not claimed.
        let stats_key = ctx.accounts.operator_stats.key();
        if stats_key != System::id() {
            let stats_info = ctx.accounts.operator_stats.to_account_info();
            require!(
                stats_info.owner == &SETTLEMENT_PROGRAM_ID,
                RegistryError::InvalidStatsOwner
            );
            let epoch_bytes = target_epoch.to_le_bytes();
            let (expected_stats_pda, _bump) = Pubkey::find_program_address(
                &[b"stats", operator_key.as_ref(), &epoch_bytes],
                &SETTLEMENT_PROGRAM_ID,
            );
            require!(
                stats_info.key() == expected_stats_pda,
                RegistryError::InvalidStatsPda
            );
            let stats = deserialize_operator_stats(&stats_info)?;
            require!(stats.epoch == target_epoch, RegistryError::EpochMismatch);
            require!(stats.payment_count == 0, RegistryError::HasPayments);
            require!(!stats.rewards_claimed, RegistryError::RewardsClaimed);
            msg!("Slashing Path B: stats exist with payment_count = 0.");
        } else {
            msg!("Slashing Path A: operator fully inactive this epoch.");
        }

        // 8. Operator must currently be active in the registry
        require!(ctx.accounts.operator_record.active, RegistryError::NotActive);

        // 9. Vault must have funds
        let vault_balance = ctx.accounts.vault.amount;
        require!(vault_balance > 0, RegistryError::EmptyVault);

        // 10. Compute slash amount: 10% to challenger, 90% stays in vault
        let slash_amount = vault_balance
            .saturating_mul(SLASH_BPS)
            .saturating_div(10_000);

        // Edge case: slash_amount could be 0 for tiny stakes — protect challenger
        require!(slash_amount > 0, RegistryError::EmptyVault);

        // 11. Mark SlashRecord (init'd by Anchor via #[account(init)] — replay-proof)
        let record      = &mut ctx.accounts.slash_record;
        record.operator = operator_key;
        record.epoch    = target_epoch;
        record.challenger = ctx.accounts.challenger.key();
        record.slash_amount = slash_amount;
        record.slashed_at = now;

        // 12. Update operator's on-chain stake tracking
        ctx.accounts.operator_record.stake = ctx.accounts.operator_record.stake
            .saturating_sub(slash_amount);

        // 13. Transfer slash_amount from vault to challenger
        let authority_key = ctx.accounts.operator_record.authority;
        let vault_seeds = &[
            b"vault",
            authority_key.as_ref(),
            &[ctx.bumps.vault],
        ];
        let signer_seeds = &[&vault_seeds[..]];

        let cpi_accounts = Transfer {
            from:      ctx.accounts.vault.to_account_info(),
            to:        ctx.accounts.challenger_token_account.to_account_info(),
            authority: ctx.accounts.vault.to_account_info(),
        };
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                cpi_accounts,
                signer_seeds,
            ),
            slash_amount,
        )?;

        msg!(
            "Slashed operator {} for epoch {}. Challenger {} receives {} tokens.",
            operator_key,
            target_epoch,
            ctx.accounts.challenger.key(),
            slash_amount
        );

        Ok(())
    }
}

// ─── Epoch constant (mirrors settlement program) ──────────────────────────────

pub const EPOCH_DURATION: i64 = 60;

// ─── Foreign account deserialization ─────────────────────────────────────────

/// Manually deserialize OperatorStats from the settlement program.
/// Layout (matches settlement lib.rs):
///   operator:        Pubkey  [32]
///   epoch:           i64     [8]
///   payment_count:   u64     [8]
///   volume:          u64     [8]
///   rewards_claimed: bool    [1]
/// Total after 8-byte discriminator: 57 bytes
#[derive(Debug)]
pub struct OperatorStatsData {
    pub operator:        Pubkey,
    pub epoch:           i64,
    pub payment_count:   u64,
    pub volume:          u64,
    pub rewards_claimed: bool,
}

fn deserialize_operator_stats(
    account: &AccountInfo,
) -> Result<OperatorStatsData> {
    let data = account.try_borrow_data()?;

    // Skip 8-byte Anchor discriminator
    let payload = &data[8..];
    require!(payload.len() >= 57, RegistryError::InvalidStatsPda);

    let operator = Pubkey::try_from(&payload[0..32]).unwrap();
    let epoch    = i64::from_le_bytes(payload[32..40].try_into().unwrap());
    let payment_count = u64::from_le_bytes(payload[40..48].try_into().unwrap());
    let volume        = u64::from_le_bytes(payload[48..56].try_into().unwrap());
    let rewards_claimed = payload[56] != 0;

    Ok(OperatorStatsData {
        operator,
        epoch,
        payment_count,
        volume,
        rewards_claimed,
    })
}

// ─── Account contexts ─────────────────────────────────────────────────────────

#[derive(Accounts)]
#[instruction(endpoint_url: String, region: String, stake_amount: u64)]
pub struct RegisterOperator<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(mut)]
    pub operator_token_account: Box<Account<'info, TokenAccount>>,

    #[account(
        init_if_needed,
        payer = authority,
        token::mint      = mint,
        token::authority = vault,
        seeds = [b"vault", authority.key().as_ref()],
        bump,
    )]
    pub vault: Box<Account<'info, TokenAccount>>,

    pub mint: Box<Account<'info, Mint>>,

    #[account(
        init_if_needed,
        payer = authority,
        space = 8 + OperatorRecord::SPACE,
        seeds = [b"operator", authority.key().as_ref()],
        bump,
    )]
    pub operator_record: Box<Account<'info, OperatorRecord>>,

    pub token_program:  Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent:           Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct DeregisterOperator<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [b"operator", authority.key().as_ref()],
        bump,
        has_one = authority,
    )]
    pub operator_record: Box<Account<'info, OperatorRecord>>,

    #[account(
        mut,
        seeds = [b"vault", authority.key().as_ref()],
        bump,
    )]
    pub vault: Box<Account<'info, TokenAccount>>,

    #[account(mut)]
    pub operator_token_account: Box<Account<'info, TokenAccount>>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
#[instruction(target_epoch: i64)]
pub struct SlashOperator<'info> {
    /// Anyone can be a challenger — no auth required
    #[account(mut)]
    pub challenger: Signer<'info>,

    /// Challenger's token account to receive the 10% slash reward
    #[account(
        mut,
        token::mint      = mint,
        token::authority = challenger,
    )]
    pub challenger_token_account: Box<Account<'info, TokenAccount>>,

    /// The operator being slashed
    #[account(
        mut,
        seeds = [b"operator", operator_record.authority.as_ref()],
        bump,
    )]
    pub operator_record: Box<Account<'info, OperatorRecord>>,

    /// Operator's stake vault — funds are transferred from here
    #[account(
        mut,
        seeds = [b"vault", operator_record.authority.as_ref()],
        bump,
    )]
    pub vault: Box<Account<'info, TokenAccount>>,

    pub mint: Box<Account<'info, Mint>>,

    /// CHECK: Either settlement program OperatorStats PDA (Path B), or SystemProgram ID as sentinel (Path A)
    pub operator_stats: UncheckedAccount<'info>,

    /// SlashRecord PDA — created here, prevents replay for same operator+epoch
    #[account(
        init,
        payer = challenger,
        space = 8 + SlashRecord::SPACE,
        seeds = [
            b"slash",
            operator_record.authority.as_ref(),
            &target_epoch.to_le_bytes(),
        ],
        bump,
    )]
    pub slash_record: Account<'info, SlashRecord>,

    pub token_program:  Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

// ─── State ────────────────────────────────────────────────────────────────────

#[account]
pub struct OperatorRecord {
    pub authority:     Pubkey,
    pub endpoint_url:  String,
    pub region:        String,
    pub stake:         u64,
    pub registered_at: i64,
    pub active:        bool,
    pub total_volume:  u64,
    pub score:         u64,
}

impl OperatorRecord {
    pub const SPACE: usize = 32 + (4 + 128) + (4 + 32) + 8 + 8 + 1 + 8 + 8;
}

/// Created once per (operator, epoch) slash event.
/// Its existence on-chain is the replay guard.
#[account]
pub struct SlashRecord {
    pub operator:     Pubkey,
    pub epoch:        i64,
    pub challenger:   Pubkey,
    pub slash_amount: u64,
    pub slashed_at:   i64,
}

impl SlashRecord {
    pub const SPACE: usize = 32 + 8 + 32 + 8 + 8; // 88 bytes
}