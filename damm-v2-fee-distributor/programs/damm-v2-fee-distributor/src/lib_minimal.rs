use anchor_lang::prelude::*;

declare_id!("11111111111111111111111111111112");

#[program]
pub mod damm_v2_fee_distributor {
    use super::*;

    pub fn initialize_honorary_position(
        _ctx: Context<InitializeHonoraryPosition>,
        _pool_id: Pubkey,
        _tick_lower: i32,
        _tick_upper: i32,
    ) -> Result<()> {
        Ok(())
    }

    pub fn crank_distribute_page(
        _ctx: Context<CrankDistributePage>,
        _page_investors: Vec<InvestorRecord>,
        _y0: u64,
        _investor_fee_share_bps: u16,
        _optional_daily_cap_lamports: Option<u64>,
        _min_payout_lamports: u64,
        _is_final_page: bool,
    ) -> Result<()> {
        Ok(())
    }
}

#[derive(Accounts)]
pub struct InitializeHonoraryPosition<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CrankDistributePage<'info> {
    pub config: AccountInfo<'info>,
    pub progress: AccountInfo<'info>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct InvestorRecord {
    pub stream_pubkey: Pubkey,
    pub investor_quote_ata: Pubkey,
}