use anchor_lang::prelude::*;

/// Streamflow interface for reading locked amounts from streams
pub trait StreamflowClient {
    fn locked_amount(&self, stream_pubkey: &Pubkey, timestamp: i64) -> Result<u64>;
}

/// Mock Streamflow implementation for testing
pub struct MockStreamflowClient {
    pub streams: std::collections::HashMap<Pubkey, StreamAccount>,
}

impl MockStreamflowClient {
    pub fn new() -> Self {
        Self {
            streams: std::collections::HashMap::new(),
        }
    }

    pub fn add_stream(&mut self, stream_pubkey: Pubkey, stream: StreamAccount) {
        self.streams.insert(stream_pubkey, stream);
    }
}

impl StreamflowClient for MockStreamflowClient {
    fn locked_amount(&self, stream_pubkey: &Pubkey, timestamp: i64) -> Result<u64> {
        match self.streams.get(stream_pubkey) {
            Some(stream) => {
                if timestamp >= stream.end_ts {
                    Ok(0) // Stream has ended
                } else if timestamp <= stream.start_ts {
                    Ok(stream.initial_allocation) // Stream hasn't started
                } else {
                    // Calculate linear unlock
                    let total_duration = stream.end_ts - stream.start_ts;
                    let elapsed = timestamp - stream.start_ts;
                    let unlocked = (stream.initial_allocation as i64 * elapsed) / total_duration;
                    let locked = stream.initial_allocation.saturating_sub(unlocked as u64);
                    Ok(locked)
                }
            }
            None => Err(StreamflowError::StreamAccountNotFound.into()),
        }
    }
}

/// Stream account structure (simplified for testing)
#[derive(Clone, Debug)]
pub struct StreamAccount {
    pub initial_allocation: u64,
    pub start_ts: i64,
    pub end_ts: i64,
    pub mint: Pubkey,
    pub recipient: Pubkey,
}

impl StreamAccount {
    pub fn new(initial_allocation: u64, start_ts: i64, end_ts: i64, mint: Pubkey, recipient: Pubkey) -> Self {
        Self {
            initial_allocation,
            start_ts,
            end_ts,
            mint,
            recipient,
        }
    }
}

/// Real Streamflow implementation (placeholder for production)
pub struct RealStreamflowClient;

impl StreamflowClient for RealStreamflowClient {
    fn locked_amount(&self, _stream_pubkey: &Pubkey, _timestamp: i64) -> Result<u64> {
        // TODO: Implement actual Streamflow stream reading
        // This would:
        // 1. Read the stream account from the blockchain
        // 2. Parse the stream data structure
        // 3. Calculate the locked amount based on the stream's vesting schedule
        // 4. Return the locked amount
        
        // For now, return a mock value
        Ok(500000)
    }
}

/// Streamflow program interface for CPI calls
pub mod streamflow_program {
    use anchor_lang::prelude::*;

    declare_id!("strmQqBqCQCBQUBmQKzYwrfRbaVHq2Q87wqxv6WtoZ1");

    pub fn get_locked_amount(
        _ctx: Context<GetLockedAmount>,
        _stream_pubkey: Pubkey,
        _timestamp: i64,
    ) -> Result<u64> {
        // This would be implemented by the actual Streamflow program
        // For now, return a mock value
        Ok(500000)
    }

    #[derive(Accounts)]
    pub struct GetLockedAmount<'info> {
        /// The stream account
        /// CHECK: Validated by Streamflow program
        pub stream: AccountInfo<'info>,
        
        /// The streamflow program
        pub streamflow_program: Program<'info, System>,
    }
}

// Error codes for Streamflow operations
#[error_code]
pub enum StreamflowError {
    #[msg("Stream account not found")]
    StreamAccountNotFound,
    #[msg("Invalid stream data")]
    InvalidStreamData,
    #[msg("Stream has not started")]
    StreamNotStarted,
    #[msg("Stream has ended")]
    StreamEnded,
}