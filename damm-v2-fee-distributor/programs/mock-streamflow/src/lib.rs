use anchor_lang::prelude::*;

declare_id!("11111111111111111111111111111113");

#[program]
pub mod mock_streamflow {
    use super::*;

    pub fn get_locked_amount(
        ctx: Context<GetLockedAmount>,
        stream_pubkey: Pubkey,
        timestamp: i64,
    ) -> Result<u64> {
        // Mock implementation - return a fixed amount for testing
        // In real implementation, this would read the stream account
        // and calculate the locked amount based on vesting schedule
        
        let stream = &ctx.accounts.stream;
        let stream_data = StreamData::try_from_slice(&stream.data.borrow())?;
        
        if timestamp >= stream_data.end_ts {
            Ok(0) // Stream has ended
        } else if timestamp <= stream_data.start_ts {
            Ok(stream_data.initial_allocation) // Stream hasn't started
        } else {
            // Calculate linear unlock
            let total_duration = stream_data.end_ts - stream_data.start_ts;
            let elapsed = timestamp - stream_data.start_ts;
            let unlocked = (stream_data.initial_allocation as i64 * elapsed) / total_duration;
            let locked = stream_data.initial_allocation.saturating_sub(unlocked as u64);
            Ok(locked)
        }
    }

    pub fn create_stream(
        ctx: Context<CreateStream>,
        initial_allocation: u64,
        start_ts: i64,
        end_ts: i64,
        mint: Pubkey,
        recipient: Pubkey,
    ) -> Result<()> {
        let stream_data = StreamData {
            initial_allocation,
            start_ts,
            end_ts,
            mint,
            recipient,
        };

        let mut stream_account = ctx.accounts.stream.try_borrow_mut_data()?;
        stream_data.serialize(&mut &mut stream_account[..])?;

        Ok(())
    }
}

#[derive(Accounts)]
pub struct GetLockedAmount<'info> {
    /// The stream account
    #[account(mut)]
    pub stream: AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct CreateStream<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    
    /// The stream account to create
    /// CHECK: This will be initialized by the instruction
    #[account(mut)]
    pub stream: AccountInfo<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct StreamData {
    pub initial_allocation: u64,
    pub start_ts: i64,
    pub end_ts: i64,
    pub mint: Pubkey,
    pub recipient: Pubkey,
}