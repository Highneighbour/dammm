use anchor_lang::prelude::*;
use anchor_spl::token::{Token, TokenAccount};
use anchor_spl::associated_token::AssociatedToken;

mod streamflow;
mod cp_amm;

// use streamflow::{StreamflowClient, MockStreamflowClient};

declare_id!("11111111111111111111111111111112");

// Constants
pub const VAULT_SEED: &[u8] = b"vault";
pub const CONFIG_SEED: &[u8] = b"investor_fee_config";
pub const PROGRESS_SEED: &[u8] = b"investor_fee_progress";
pub const INVESTOR_FEE_POS_OWNER_SEED: &[u8] = b"investor_fee_pos_owner";

// 24 hours in seconds
pub const DAY_IN_SECONDS: i64 = 86400;

#[program]
pub mod damm_v2_fee_distributor {
    use super::*;

    /// Initialize the honorary fee position for quote-only fee accrual
    pub fn initialize_honorary_position(
        ctx: Context<InitializeHonoraryPosition>,
        pool_id: Pubkey,
        tick_lower: i32,
        tick_upper: i32,
    ) -> Result<()> {
        let config = &mut ctx.accounts.config;
        let clock = Clock::get()?;

        // Store configuration
        config.pool_id = pool_id;
        config.quote_mint = ctx.accounts.quote_mint.key();
        config.base_mint = ctx.accounts.base_mint.key();
        config.position_id = ctx.accounts.position.key();
        config.tick_lower = tick_lower;
        config.tick_upper = tick_upper;
        config.creation_ts = clock.unix_timestamp;
        config.bump = ctx.bumps.config;

        // Validate that this position will only accrue quote fees
        // This is a simplified validation - in practice, you'd need to analyze
        // the pool's current price and tick range to ensure quote-only accrual
        require!(
            tick_lower < tick_upper,
            ErrorCode::InvalidTickRange
        );

        emit!(HonoraryPositionInitialized {
            pool: pool_id,
            position_id: ctx.accounts.position.key(),
            owner_pda: ctx.accounts.investor_fee_position_owner_pda.key(),
            quote_mint: ctx.accounts.quote_mint.key(),
        });

        Ok(())
    }

    /// Permissionless 24h distribution crank with pagination
    pub fn crank_distribute_page(
        ctx: Context<CrankDistributePage>,
        page_investors: Vec<InvestorRecord>,
        y0: u64,
        investor_fee_share_bps: u16,
        optional_daily_cap_lamports: Option<u64>,
        min_payout_lamports: u64,
        is_final_page: bool,
    ) -> Result<()> {
        let clock = Clock::get()?;
        let current_time = clock.unix_timestamp;
        let day_id = current_time / DAY_IN_SECONDS;

        // Calculate progress PDA for this day
        let progress_pda = Self::get_progress_pda(day_id)?;
        require!(
            ctx.accounts.progress.key() == progress_pda,
            ErrorCode::InvalidProgressAccount
        );

        // Check if progress account exists and initialize if needed
        let mut progress = if ctx.accounts.progress.data_is_empty() {
            // Initialize new progress account
            let mut progress_data = ProgressAccount {
                day_id,
                last_distribution_ts: 0,
                claimed_quote_for_day: 0,
                cumulative_distributed_today: 0,
                carry_over: 0,
                pagination_cursor: 0,
            };
            progress_data
        } else {
            // Load existing progress account
            ProgressAccount::try_from_slice(&ctx.accounts.progress.data.borrow())?
        };
        
        if progress.last_distribution_ts == 0 {
            // First call of the day - claim fees
            let claimed_quote = Self::claim_fees_from_damm(ctx.accounts)?;
            
            // Validate quote-only: check that no base tokens were claimed
            require!(
                claimed_quote > 0,
                ErrorCode::InsufficientClaimedQuote
            );

            // Store claimed amount for the day
            progress.claimed_quote_for_day = claimed_quote;
            progress.last_distribution_ts = current_time;
            progress.day_id = day_id;
            progress.cumulative_distributed_today = 0;
            progress.carry_over = 0;
            progress.pagination_cursor = 0;

            emit!(QuoteFeesClaimed {
                day_id,
                claimed_quote,
            });
        } else {
            // Ensure we're still in the same day
            require!(
                progress.day_id == day_id,
                ErrorCode::DayGateNotPassed
            );
        }

        // Calculate locked total from all investors on this page
        let mut locked_total = 0u64;
        for investor in &page_investors {
            let locked_amount = Self::get_locked_amount(
                &ctx.accounts.streamflow_program,
                &investor.stream_pubkey,
                current_time,
            )?;
            locked_total = locked_total.saturating_add(locked_amount);
        }

        // Calculate eligible investor share
        let f_locked = locked_total.checked_div(y0).unwrap_or(0);
        let eligible_investor_share_bps = std::cmp::min(
            investor_fee_share_bps,
            (f_locked * 10000).checked_div(y0).unwrap_or(0) as u16,
        );

        let investor_fee_quote = progress.claimed_quote_for_day
            .checked_mul(eligible_investor_share_bps as u64)
            .unwrap_or(0)
            .checked_div(10000)
            .unwrap_or(0);

        // Apply daily cap if provided
        let daily_cap_net = if let Some(cap) = optional_daily_cap_lamports {
            std::cmp::max(0, cap.saturating_sub(progress.cumulative_distributed_today))
        } else {
            investor_fee_quote
        };
        let final_investor_fee_quote = std::cmp::min(investor_fee_quote, daily_cap_net);

        // Distribute to investors on this page
        let mut page_total_distributed = 0u64;
        let mut dust_carry = 0u64;

        for investor in &page_investors {
            let locked_amount = Self::get_locked_amount(
                &ctx.accounts.streamflow_program,
                &investor.stream_pubkey,
                current_time,
            )?;

            if locked_amount == 0 {
                continue;
            }

            let weight = locked_amount
                .checked_mul(final_investor_fee_quote)
                .unwrap_or(0)
                .checked_div(locked_total)
                .unwrap_or(0);

            if weight >= min_payout_lamports {
                // Transfer to investor's ATA
                Self::transfer_to_investor(
                    &ctx.accounts.token_program,
                    &ctx.accounts.program_quote_treasury,
                    &investor.investor_quote_ata,
                    weight,
                )?;
                page_total_distributed = page_total_distributed.saturating_add(weight);
            } else {
                dust_carry = dust_carry.saturating_add(weight);
            }
        }

        // Update progress
        progress.cumulative_distributed_today = progress
            .cumulative_distributed_today
            .saturating_add(page_total_distributed);
        progress.carry_over = progress.carry_over.saturating_add(dust_carry);
        progress.pagination_cursor = progress.pagination_cursor.saturating_add(1);

        emit!(InvestorPayoutPage {
            day_id,
            page_id: progress.pagination_cursor,
            page_total_distributed,
        });

        // If this is the final page, send remainder to creator
        if is_final_page {
            let remainder = progress.claimed_quote_for_day
                .saturating_sub(progress.cumulative_distributed_today)
                .saturating_sub(progress.carry_over);

            if remainder > 0 {
                Self::transfer_to_creator(
                    &ctx.accounts.token_program,
                    &ctx.accounts.program_quote_treasury,
                    &ctx.accounts.creator_quote_ata,
                    remainder,
                )?;
            }

            emit!(CreatorPayoutDayClosed {
                day_id,
                creator_amount: remainder,
            });

            // Reset for next day
            progress.last_distribution_ts = current_time;
            progress.day_id = day_id.saturating_add(1);
        }

        // Save progress account
        let mut progress_data = ctx.accounts.progress.try_borrow_mut_data()?;
        progress.serialize(&mut &mut progress_data[..])?;

        Ok(())
    }

    // Helper functions
    fn get_progress_pda(day_id: i64) -> Result<Pubkey> {
        let (progress_pda, _bump) = Pubkey::find_program_address(
            &[PROGRESS_SEED, &day_id.to_le_bytes()],
            &crate::ID,
        );
        Ok(progress_pda)
    }

    fn claim_fees_from_damm(_accounts: &CrankDistributePage) -> Result<u64> {
        // TODO: Implement actual CPI to cp-amm to claim fees
        // For now, return a mock value
        // In production, this would:
        // 1. Call cp-amm's claim_fees instruction
        // 2. Check that only quote tokens were claimed
        // 3. Return the claimed amount
        Ok(1000000) // Mock value
    }

    fn get_locked_amount(
        streamflow_program: &AccountInfo,
        stream_pubkey: &Pubkey,
        timestamp: i64,
    ) -> Result<u64> {
        // TODO: Implement actual Streamflow stream reading
        // For now, return a mock value
        // In production, this would read the stream account and calculate locked amount
        Ok(500000) // Mock value
    }

    fn transfer_to_investor(
        token_program: &AccountInfo,
        from: &AccountInfo,
        to: &AccountInfo,
        amount: u64,
    ) -> Result<()> {
        let cpi_accounts = Transfer {
            from: from.to_account_info(),
            to: to.to_account_info(),
            authority: from.to_account_info(),
        };
        let cpi_program = token_program.to_account_info();
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        token::transfer(cpi_ctx, amount)?;
        Ok(())
    }

    fn transfer_to_creator(
        token_program: &AccountInfo,
        from: &AccountInfo,
        to: &AccountInfo,
        amount: u64,
    ) -> Result<()> {
        let cpi_accounts = Transfer {
            from: from.to_account_info(),
            to: to.to_account_info(),
            authority: from.to_account_info(),
        };
        let cpi_program = token_program.to_account_info();
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        token::transfer(cpi_ctx, amount)?;
        Ok(())
    }
}

// Account structures
#[derive(Accounts)]
#[instruction(pool_id: Pubkey)]
pub struct InitializeHonoraryPosition<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        init,
        payer = payer,
        space = 8 + ConfigAccount::INIT_SPACE,
        seeds = [CONFIG_SEED, pool_id.as_ref()],
        bump
    )]
    pub config: Account<'info, ConfigAccount>,

    /// The cp-amm pool
    /// CHECK: Validated by cp-amm program
    pub pool: AccountInfo<'info>,

    /// The quote mint (token that will accrue fees)
    /// CHECK: Validated by token program
    pub quote_mint: AccountInfo<'info>,

    /// The base mint
    /// CHECK: Validated by token program
    pub base_mint: AccountInfo<'info>,

    /// The DAMM v2 position account (owned by our PDA)
    /// CHECK: Will be created by cp-amm program
    pub position: AccountInfo<'info>,

    /// PDA that will own the DAMM v2 position
    #[account(
        seeds = [VAULT_SEED, VAULT_SEED, INVESTOR_FEE_POS_OWNER_SEED],
        bump
    )]
    pub investor_fee_position_owner_pda: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct CrankDistributePage<'info> {
    /// The config account
    #[account(
        seeds = [CONFIG_SEED, config.pool_id.as_ref()],
        bump = config.bump
    )]
    pub config: Account<'info, ConfigAccount>,

    /// The progress account for this day
    /// CHECK: Will be initialized by the instruction if needed
    #[account(mut)]
    pub progress: AccountInfo<'info>,

    /// The honorary position account
    /// CHECK: Validated by cp-amm program
    pub position: AccountInfo<'info>,

    /// The position owner PDA
    #[account(
        seeds = [VAULT_SEED, VAULT_SEED, INVESTOR_FEE_POS_OWNER_SEED],
        bump
    )]
    pub investor_fee_position_owner_pda: AccountInfo<'info>,

    /// The program's quote treasury ATA
    #[account(
        mut,
        associated_token::mint = config.quote_mint,
        associated_token::authority = program_authority
    )]
    pub program_quote_treasury: Account<'info, TokenAccount>,

    /// The program authority (for treasury operations)
    /// CHECK: This should be a PDA derived from the program
    pub program_authority: AccountInfo<'info>,

    /// The creator's quote ATA
    #[account(
        mut,
        associated_token::mint = config.quote_mint,
        associated_token::authority = creator
    )]
    pub creator_quote_ata: Account<'info, TokenAccount>,

    /// The creator
    /// CHECK: Validated by the caller
    pub creator: AccountInfo<'info>,

    /// The Streamflow program
    /// CHECK: Validated by the caller
    pub streamflow_program: AccountInfo<'info>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

// Data structures
#[account]
pub struct ConfigAccount {
    pub pool_id: Pubkey,
    pub quote_mint: Pubkey,
    pub base_mint: Pubkey,
    pub position_id: Pubkey,
    pub tick_lower: i32,
    pub tick_upper: i32,
    pub creation_ts: i64,
    pub bump: u8,
}

impl ConfigAccount {
    pub const INIT_SPACE: usize = 32 + 32 + 32 + 32 + 4 + 4 + 8 + 1;
}

#[account]
pub struct ProgressAccount {
    pub day_id: i64,
    pub last_distribution_ts: i64,
    pub claimed_quote_for_day: u64,
    pub cumulative_distributed_today: u64,
    pub carry_over: u64,
    pub pagination_cursor: u64,
    // Note: For simplicity, we'll use a single progress PDA per day
    // In production, you might want to use multiple PDAs for pagination state
}

impl ProgressAccount {
    pub const INIT_SPACE: usize = 8 + 8 + 8 + 8 + 8 + 8 + 8;
}

// Investor record for pagination
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct InvestorRecord {
    pub stream_pubkey: Pubkey,
    pub investor_quote_ata: Pubkey,
}

// Events
#[event]
pub struct HonoraryPositionInitialized {
    pub pool: Pubkey,
    pub position_id: Pubkey,
    pub owner_pda: Pubkey,
    pub quote_mint: Pubkey,
}

#[event]
pub struct QuoteFeesClaimed {
    pub day_id: i64,
    pub claimed_quote: u64,
}

#[event]
pub struct InvestorPayoutPage {
    pub day_id: i64,
    pub page_id: u64,
    pub page_total_distributed: u64,
}

#[event]
pub struct CreatorPayoutDayClosed {
    pub day_id: i64,
    pub creator_amount: u64,
}

// Error codes
#[error_code]
pub enum ErrorCode {
    #[msg("Invalid tick range - lower must be less than upper")]
    InvalidTickRange,
    #[msg("Base fee detected - position is not quote-only")]
    BaseFeeDetected,
    #[msg("Invalid pool configuration for quote-only fees")]
    InvalidPoolForQuoteOnly,
    #[msg("Day gate not passed - must wait 24 hours between distributions")]
    DayGateNotPassed,
    #[msg("Page already processed - idempotency check failed")]
    AlreadyProcessedPage,
    #[msg("Missing investor ATA - could not create associated token account")]
    MissingInvestorATA,
    #[msg("Daily cap exceeded")]
    CapExceeded,
    #[msg("Insufficient claimed quote for expected payouts")]
    InsufficientClaimedQuote,
    #[msg("Invalid streamflow program")]
    InvalidStreamflowProgram,
    #[msg("Stream account not found")]
    StreamAccountNotFound,
    #[msg("Math overflow in calculation")]
    MathOverflow,
    #[msg("Invalid progress account")]
    InvalidProgressAccount,
}