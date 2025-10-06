# DAMM v2 Honorary Quote-Only Fee Position + 24h Distribution Crank

A production-quality Anchor-compatible Rust program that implements a fee distribution system for DAMM v2 positions, designed to distribute quote-only fees to investors based on their locked token balances from Streamflow streams.

## 📋 Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Dependencies & Version Pins](#dependencies--version-pins)
- [PDAs & Seeds](#pdas--seeds)
- [Account Tables](#account-tables)
- [Instructions](#instructions)
- [Events](#events)
- [Error Codes](#error-codes)
- [Installation & Setup](#installation--setup)
- [Testing](#testing)
- [Demo Scripts](#demo-scripts)
- [Integration Guide](#integration-guide)
- [Security Considerations](#security-considerations)
- [Troubleshooting](#troubleshooting)

## 🎯 Overview

This program creates and manages an "honorary" DAMM v2 LP position that accrues fees exclusively in the quote mint. It provides a permissionless, once-per-24h, paginated crank that:

1. Claims quote fees from the position via cp-amm CPI
2. Distributes claimed fees pro-rata to investors based on their still-locked Streamflow balances
3. Routes remainder to the creator
4. Enforces deterministic failure if any base fees are detected

### Key Features

- ✅ **Quote-only fee validation** - Ensures position only accrues quote tokens
- ✅ **24-hour distribution gate** - Enforces once-per-day distribution limit
- ✅ **Pagination support** - Handles large investor lists across multiple pages
- ✅ **Idempotent operations** - Safe to retry failed transactions
- ✅ **Dust handling** - Carries forward small amounts to next day
- ✅ **Daily caps** - Optional limits on daily distributions
- ✅ **Deterministic failure** - Fails cleanly if base fees detected

## 🏗️ Architecture

### Core Components

1. **Honorary Position** - DAMM v2 position owned by program PDA for fee accrual
2. **Config PDA** - Stores pool configuration and position metadata
3. **Progress PDA** - Tracks distribution state per day
4. **Streamflow Interface** - Reads locked amounts from investor streams
5. **cp-amm Integration** - Claims fees via CPI calls

### Data Flow

```
1. Initialize honorary position → 2. Fees accrue in position → 3. Crank claims fees → 4. Distribute to investors → 5. Route remainder to creator
```

## 📦 Dependencies & Version Pins

| Dependency | Version | Source | Commit/Tag |
|------------|---------|--------|------------|
| Anchor | 0.31.1 | [coral-xyz/anchor](https://github.com/coral-xyz/anchor) | d5d7eb97 |
| Solana | 1.18.0 | [solana-labs/solana](https://github.com/solana-labs/solana) | v1.18.0 |
| SPL Token | 4.0.0 | [solana-labs/solana-program-library](https://github.com/solana-labs/solana-program-library) | v1.18.0 |
| cp-amm | Latest | [cp-amm/damm-v2](https://github.com/cp-amm/damm-v2) | TBD |
| Streamflow | Latest | [streamflow-finance/streamflow](https://github.com/streamflow-finance/streamflow) | TBD |

## 🔑 PDAs & Seeds

### Program Authority
```rust
seeds: [b"program_authority"]
```

### Config PDA
```rust
seeds: [b"investor_fee_config", pool_id]
```

### Progress PDA
```rust
seeds: [b"investor_fee_progress", day_id.to_le_bytes()]
```

### Investor Fee Position Owner PDA
```rust
seeds: [b"vault", b"vault", b"investor_fee_pos_owner"]
```

## 📊 Account Tables

### `initialize_honorary_position`

| Account | Type | Writable | Signer | Description |
|---------|------|----------|--------|-------------|
| `payer` | Account | ✅ | ✅ | Pays for account creation |
| `config` | PDA | ✅ | ❌ | Config account (init) |
| `pool` | Account | ❌ | ❌ | cp-amm pool account |
| `quote_mint` | Account | ❌ | ❌ | Quote token mint |
| `base_mint` | Account | ❌ | ❌ | Base token mint |
| `position` | Account | ❌ | ❌ | DAMM v2 position account |
| `investor_fee_position_owner_pda` | PDA | ❌ | ❌ | Position owner PDA |
| `system_program` | Program | ❌ | ❌ | System program |
| `token_program` | Program | ❌ | ❌ | SPL Token program |
| `rent` | Sysvar | ❌ | ❌ | Rent sysvar |

### `crank_distribute_page`

| Account | Type | Writable | Signer | Description |
|---------|------|----------|--------|-------------|
| `config` | PDA | ❌ | ❌ | Config account |
| `progress` | PDA | ✅ | ❌ | Progress account (init_if_needed) |
| `position` | Account | ❌ | ❌ | Honorary position account |
| `investor_fee_position_owner_pda` | PDA | ❌ | ❌ | Position owner PDA |
| `program_quote_treasury` | ATA | ✅ | ❌ | Program's quote treasury |
| `program_authority` | PDA | ❌ | ❌ | Program authority |
| `creator_quote_ata` | ATA | ✅ | ❌ | Creator's quote ATA |
| `creator` | Account | ❌ | ❌ | Creator account |
| `streamflow_program` | Program | ❌ | ❌ | Streamflow program |
| `token_program` | Program | ❌ | ❌ | SPL Token program |
| `associated_token_program` | Program | ❌ | ❌ | Associated Token program |
| `system_program` | Program | ❌ | ❌ | System program |

## 🛠️ Instructions

### `initialize_honorary_position`

Initializes the honorary fee position for quote-only fee accrual.

**Parameters:**
- `pool_id: Pubkey` - The cp-amm pool ID
- `tick_lower: i32` - Lower tick bound
- `tick_upper: i32` - Upper tick bound

**Behavior:**
1. Validates tick range (lower < upper)
2. Creates config PDA with pool metadata
3. Validates quote-only fee accrual (simplified)
4. Emits `HonoraryPositionInitialized` event

### `crank_distribute_page`

Permissionless 24h distribution crank with pagination.

**Parameters:**
- `page_investors: Vec<InvestorRecord>` - Page of investor records
- `y0: u64` - Total allocation for share calculation
- `investor_fee_share_bps: u16` - Investor fee share in basis points
- `optional_daily_cap_lamports: Option<u64>` - Optional daily cap
- `min_payout_lamports: u64` - Minimum payout threshold
- `is_final_page: bool` - Whether this is the final page

**Behavior:**
1. Enforces 24-hour gate (first call of day)
2. Claims fees from cp-amm (first call only)
3. Validates quote-only (fails if base fees detected)
4. Calculates locked amounts from Streamflow
5. Distributes pro-rata to investors
6. Handles dust and daily caps
7. Routes remainder to creator (final page only)

## 📡 Events

### `HonoraryPositionInitialized`
```rust
pub struct HonoraryPositionInitialized {
    pub pool: Pubkey,
    pub position_id: Pubkey,
    pub owner_pda: Pubkey,
    pub quote_mint: Pubkey,
}
```

### `QuoteFeesClaimed`
```rust
pub struct QuoteFeesClaimed {
    pub day_id: i64,
    pub claimed_quote: u64,
}
```

### `InvestorPayoutPage`
```rust
pub struct InvestorPayoutPage {
    pub day_id: i64,
    pub page_id: u64,
    pub page_total_distributed: u64,
}
```

### `CreatorPayoutDayClosed`
```rust
pub struct CreatorPayoutDayClosed {
    pub day_id: i64,
    pub creator_amount: u64,
}
```

## ❌ Error Codes

| Code | Name | Description |
|------|------|-------------|
| 6000 | `InvalidTickRange` | Lower tick must be less than upper tick |
| 6001 | `BaseFeeDetected` | Base token detected after claim |
| 6002 | `InvalidPoolForQuoteOnly` | Pool config cannot guarantee quote-only |
| 6003 | `DayGateNotPassed` | Must wait 24 hours between distributions |
| 6004 | `AlreadyProcessedPage` | Page already processed (idempotency) |
| 6005 | `MissingInvestorATA` | Could not create investor ATA |
| 6006 | `CapExceeded` | Daily cap exceeded |
| 6007 | `InsufficientClaimedQuote` | Insufficient claimed quote for payouts |
| 6008 | `InvalidStreamflowProgram` | Invalid Streamflow program |
| 6009 | `StreamAccountNotFound` | Stream account not found |
| 6010 | `MathOverflow` | Math overflow in calculation |

## 🚀 Installation & Setup

### Prerequisites

- Rust 1.70+
- Solana CLI 1.18.0+
- Anchor CLI 0.31.1+
- Node.js 18+
- Yarn

### Installation

1. **Clone the repository:**
```bash
git clone <repository-url>
cd damm-v2-fee-distributor
```

2. **Install dependencies:**
```bash
npm install
```

3. **Build the program:**
```bash
anchor build
```

4. **Start local validator:**
```bash
solana-test-validator --reset
```

5. **Deploy the program:**
```bash
anchor deploy
```

## 🧪 Testing

### Run All Tests
```bash
anchor test
```

### Run Specific Test
```bash
anchor test --grep "initialize_honorary_position"
```

### Test Coverage
The test suite covers:
- ✅ Position initialization (success/failure cases)
- ✅ Quote-only validation
- ✅ Fee distribution crank
- ✅ Pagination handling
- ✅ 24-hour gate enforcement
- ✅ Dust and cap handling
- ✅ Idempotency checks

### Test Scenarios

1. **Init Success** - Valid pool config creates position
2. **Init Failure** - Invalid tick range rejected
3. **Quote Accrual** - Simulates fee accrual and distribution
4. **Pagination** - Multiple pages processed correctly
5. **All Unlocked** - Entire claim goes to creator
6. **Base Fee Failure** - Detects and rejects base fees
7. **Cap & Dust** - Handles daily caps and dust carryover

## 🎮 Demo Scripts

### Run Demo
```bash
cd scripts
npm install
npm run demo
```

### Demo Features
- Creates test accounts and token mints
- Initializes honorary position
- Simulates fee accrual
- Runs crank distribution
- Tests pagination
- Shows transaction signatures and account states

## 🔌 Integration Guide

### For Star Launch Protocol

1. **Deploy the program** to your cluster
2. **Initialize honorary position** with your pool configuration
3. **Set up investor pages** with Streamflow stream addresses
4. **Call crank_distribute_page** daily with investor data

### Example Integration

```typescript
// Initialize position
await program.methods
  .initializeHonoraryPosition(poolId, tickLower, tickUpper)
  .accounts({ /* accounts */ })
  .rpc();

// Run daily crank
await program.methods
  .crankDistributePage(
    investorPage,
    y0,
    investorFeeShareBps,
    dailyCap,
    minPayout,
    isFinalPage
  )
  .accounts({ /* accounts */ })
  .rpc();
```

### Configuration Parameters

- `y0`: Total token allocation for share calculation
- `investor_fee_share_bps`: Percentage of fees for investors (0-10000)
- `daily_cap`: Optional daily distribution limit
- `min_payout`: Minimum payout to avoid dust

## 🔒 Security Considerations

### Access Control
- Position ownership: Program PDA only
- Fee claiming: Program authority only
- Distribution: Permissionless but rate-limited

### Validation
- Quote-only enforcement at claim time
- 24-hour distribution gate
- Idempotency checks for pagination
- Math overflow protection

### Risk Mitigation
- Deterministic failure on base fees
- Dust carryover to prevent loss
- Daily caps to limit exposure
- Comprehensive error handling

## 🐛 Troubleshooting

### Common Issues

1. **"Invalid tick range"**
   - Ensure `tick_lower < tick_upper`
   - Check tick values are within valid range

2. **"Day gate not passed"**
   - Wait 24 hours between distributions
   - Check `last_distribution_ts` in progress account

3. **"Base fee detected"**
   - Position is not quote-only
   - Recreate position with different tick range

4. **"Missing investor ATA"**
   - Create ATA before distribution
   - Check investor public key is correct

### Debug Commands

```bash
# Check account state
solana account <account-pubkey>

# View program logs
solana logs <program-id>

# Check transaction
solana confirm <tx-signature>
```

### Getting Help

1. Check error codes in this README
2. Review test cases for examples
3. Check program logs for detailed error messages
4. Verify account states and PDAs

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests
5. Submit a pull request

## 📞 Support

For questions or issues:
- Create an issue in the repository
- Check the troubleshooting section
- Review the test cases for examples

---

**⚠️ Disclaimer**: This software is provided as-is for educational and development purposes. Always audit and test thoroughly before using in production.