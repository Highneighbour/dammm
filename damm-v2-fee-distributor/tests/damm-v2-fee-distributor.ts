import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { DammV2FeeDistributor } from "../target/types/damm_v2_fee_distributor";
import { PublicKey, Keypair, SystemProgram, SYSVAR_RENT_PUBKEY } from "@solana/web3.js";
import { 
  TOKEN_PROGRAM_ID, 
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createMint,
  createAccount,
  mintTo,
  getAccount,
  getAssociatedTokenAddress,
} from "@solana/spl-token";
import { expect } from "chai";

describe("damm-v2-fee-distributor", () => {
  // Configure the client to use the local cluster.
  anchor.setProvider(anchor.AnchorProvider.env());

  const program = anchor.workspace.DammV2FeeDistributor as Program<DammV2FeeDistributor>;
  const provider = anchor.getProvider();

  // Test accounts
  let payer: Keypair;
  let creator: Keypair;
  let investor1: Keypair;
  let investor2: Keypair;
  let investor3: Keypair;
  
  // Token mints
  let quoteMint: PublicKey;
  let baseMint: PublicKey;
  
  // Pool and position
  let poolId: PublicKey;
  let positionId: PublicKey;
  
  // PDAs
  let configPda: PublicKey;
  let investorFeePositionOwnerPda: PublicKey;
  let programAuthorityPda: PublicKey;
  let programQuoteTreasury: PublicKey;
  let creatorQuoteAta: PublicKey;
  let investor1QuoteAta: PublicKey;
  let investor2QuoteAta: PublicKey;
  let investor3QuoteAta: PublicKey;

  before(async () => {
    // Generate keypairs
    payer = Keypair.generate();
    creator = Keypair.generate();
    investor1 = Keypair.generate();
    investor2 = Keypair.generate();
    investor3 = Keypair.generate();

    // Airdrop SOL to payer
    await provider.connection.requestAirdrop(payer.publicKey, 10 * anchor.web3.LAMPORTS_PER_SOL);
    await provider.connection.requestAirdrop(creator.publicKey, 10 * anchor.web3.LAMPORTS_PER_SOL);
    await provider.connection.requestAirdrop(investor1.publicKey, 10 * anchor.web3.LAMPORTS_PER_SOL);
    await provider.connection.requestAirdrop(investor2.publicKey, 10 * anchor.web3.LAMPORTS_PER_SOL);
    await provider.connection.requestAirdrop(investor3.publicKey, 10 * anchor.web3.LAMPORTS_PER_SOL);

    // Create token mints
    quoteMint = await createMint(
      provider.connection,
      payer,
      payer.publicKey,
      null,
      6
    );

    baseMint = await createMint(
      provider.connection,
      payer,
      payer.publicKey,
      null,
      6
    );

    // Generate pool and position IDs
    poolId = Keypair.generate().publicKey;
    positionId = Keypair.generate().publicKey;

    // Calculate PDAs
    [configPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("investor_fee_config"), poolId.toBuffer()],
      program.programId
    );

    [investorFeePositionOwnerPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), Buffer.from("vault"), Buffer.from("investor_fee_pos_owner")],
      program.programId
    );

    [programAuthorityPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("program_authority")],
      program.programId
    );

    // Calculate ATAs
    programQuoteTreasury = await getAssociatedTokenAddress(quoteMint, programAuthorityPda, true);
    creatorQuoteAta = await getAssociatedTokenAddress(quoteMint, creator.publicKey);
    investor1QuoteAta = await getAssociatedTokenAddress(quoteMint, investor1.publicKey);
    investor2QuoteAta = await getAssociatedTokenAddress(quoteMint, investor2.publicKey);
    investor3QuoteAta = await getAssociatedTokenAddress(quoteMint, investor3.publicKey);
  });

  it("Initializes honorary position successfully", async () => {
    const tickLower = -1000;
    const tickUpper = 1000;

    const tx = await program.methods
      .initializeHonoraryPosition(poolId, tickLower, tickUpper)
      .accounts({
        payer: payer.publicKey,
        config: configPda,
        pool: poolId,
        quoteMint: quoteMint,
        baseMint: baseMint,
        position: positionId,
        investorFeePositionOwnerPda: investorFeePositionOwnerPda,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .signers([payer])
      .rpc();

    console.log("Initialize transaction signature:", tx);

    // Verify config account was created
    const configAccount = await program.account.configAccount.fetch(configPda);
    expect(configAccount.poolId.toString()).to.equal(poolId.toString());
    expect(configAccount.quoteMint.toString()).to.equal(quoteMint.toString());
    expect(configAccount.baseMint.toString()).to.equal(baseMint.toString());
    expect(configAccount.tickLower).to.equal(tickLower);
    expect(configAccount.tickUpper).to.equal(tickUpper);
  });

  it("Fails to initialize with invalid tick range", async () => {
    const invalidPoolId = Keypair.generate().publicKey;
    const [invalidConfigPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("investor_fee_config"), invalidPoolId.toBuffer()],
      program.programId
    );

    try {
      await program.methods
        .initializeHonoraryPosition(invalidPoolId, 1000, -1000) // Invalid: lower > upper
        .accounts({
          payer: payer.publicKey,
          config: invalidConfigPda,
          pool: invalidPoolId,
          quoteMint: quoteMint,
          baseMint: baseMint,
          position: Keypair.generate().publicKey,
          investorFeePositionOwnerPda: investorFeePositionOwnerPda,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .signers([payer])
        .rpc();

      expect.fail("Should have failed with invalid tick range");
    } catch (error) {
      expect(error.message).to.include("Invalid tick range");
    }
  });

  it("Runs crank distribution successfully", async () => {
    // Create ATAs first
    await createAccount(provider.connection, payer, quoteMint, creator.publicKey);
    await createAccount(provider.connection, payer, quoteMint, investor1.publicKey);
    await createAccount(provider.connection, payer, quoteMint, investor2.publicKey);
    await createAccount(provider.connection, payer, quoteMint, investor3.publicKey);

    // Mint some tokens to the program treasury for testing
    await mintTo(
      provider.connection,
      payer,
      quoteMint,
      programQuoteTreasury,
      payer,
      1000000 // 1M tokens
    );

    // Create mock stream accounts for investors
    const stream1 = Keypair.generate().publicKey;
    const stream2 = Keypair.generate().publicKey;
    const stream3 = Keypair.generate().publicKey;

    const pageInvestors = [
      {
        streamPubkey: stream1,
        investorQuoteAta: investor1QuoteAta,
      },
      {
        streamPubkey: stream2,
        investorQuoteAta: investor2QuoteAta,
      },
      {
        streamPubkey: stream3,
        investorQuoteAta: investor3QuoteAta,
      },
    ];

    const y0 = 1000000; // 1M total allocation
    const investorFeeShareBps = 5000; // 50%
    const minPayoutLamports = 1000; // 1K minimum payout

    // Calculate progress PDA for today
    const clock = await provider.connection.getAccountInfo(anchor.web3.SYSVAR_CLOCK_PUBKEY);
    const currentTime = Math.floor(Date.now() / 1000);
    const dayId = Math.floor(currentTime / 86400);
    const [progressPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("investor_fee_progress"), Buffer.from(dayId.toString())],
      program.programId
    );

    const tx = await program.methods
      .crankDistributePage(
        pageInvestors,
        new anchor.BN(y0),
        investorFeeShareBps,
        null, // No daily cap
        new anchor.BN(minPayoutLamports),
        true // Final page
      )
      .accounts({
        config: configPda,
        progress: progressPda,
        position: positionId,
        investorFeePositionOwnerPda: investorFeePositionOwnerPda,
        programQuoteTreasury: programQuoteTreasury,
        programAuthority: programAuthorityPda,
        creatorQuoteAta: creatorQuoteAta,
        creator: creator.publicKey,
        streamflowProgram: program.programId, // Mock for testing
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    console.log("Crank distribution transaction signature:", tx);

    // Verify progress account was created
    const progressAccount = await program.account.progressAccount.fetch(progressPda);
    expect(progressAccount.dayId.toString()).to.equal(dayId.toString());
    expect(progressAccount.claimedQuoteForDay.toString()).to.equal("1000000");
  });

  it("Handles pagination correctly", async () => {
    // Test with multiple pages
    const page1Investors = [
      {
        streamPubkey: Keypair.generate().publicKey,
        investorQuoteAta: investor1QuoteAta,
      },
    ];

    const page2Investors = [
      {
        streamPubkey: Keypair.generate().publicKey,
        investorQuoteAta: investor2QuoteAta,
      },
    ];

    const y0 = 1000000;
    const investorFeeShareBps = 5000;
    const minPayoutLamports = 1000;

    // Calculate progress PDA for tomorrow
    const currentTime = Math.floor(Date.now() / 1000);
    const tomorrowDayId = Math.floor(currentTime / 86400) + 1;
    const [progressPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("investor_fee_progress"), Buffer.from(tomorrowDayId.toString())],
      program.programId
    );

    // First page
    await program.methods
      .crankDistributePage(
        page1Investors,
        new anchor.BN(y0),
        investorFeeShareBps,
        null,
        new anchor.BN(minPayoutLamports),
        false // Not final page
      )
      .accounts({
        config: configPda,
        progress: progressPda,
        position: positionId,
        investorFeePositionOwnerPda: investorFeePositionOwnerPda,
        programQuoteTreasury: programQuoteTreasury,
        programAuthority: programAuthorityPda,
        creatorQuoteAta: creatorQuoteAta,
        creator: creator.publicKey,
        streamflowProgram: program.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    // Second page (final)
    await program.methods
      .crankDistributePage(
        page2Investors,
        new anchor.BN(y0),
        investorFeeShareBps,
        null,
        new anchor.BN(minPayoutLamports),
        true // Final page
      )
      .accounts({
        config: configPda,
        progress: progressPda,
        position: positionId,
        investorFeePositionOwnerPda: investorFeePositionOwnerPda,
        programQuoteTreasury: programQuoteTreasury,
        programAuthority: programAuthorityPda,
        creatorQuoteAta: creatorQuoteAta,
        creator: creator.publicKey,
        streamflowProgram: program.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    // Verify progress account shows both pages processed
    const progressAccount = await program.account.progressAccount.fetch(progressPda);
    expect(progressAccount.paginationCursor.toString()).to.equal("2");
  });

  it("Enforces 24-hour gate", async () => {
    // Try to run crank again immediately (should fail)
    const currentTime = Math.floor(Date.now() / 1000);
    const dayId = Math.floor(currentTime / 86400);
    const [progressPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("investor_fee_progress"), Buffer.from(dayId.toString())],
      program.programId
    );

    try {
      await program.methods
        .crankDistributePage(
          [],
          new anchor.BN(1000000),
          5000,
          null,
          new anchor.BN(1000),
          true
        )
        .accounts({
          config: configPda,
          progress: progressPda,
          position: positionId,
          investorFeePositionOwnerPda: investorFeePositionOwnerPda,
          programQuoteTreasury: programQuoteTreasury,
          programAuthority: programAuthorityPda,
          creatorQuoteAta: creatorQuoteAta,
          creator: creator.publicKey,
          streamflowProgram: program.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      expect.fail("Should have failed due to day gate");
    } catch (error) {
      expect(error.message).to.include("Day gate not passed");
    }
  });
});