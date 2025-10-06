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

async function main() {
  console.log("🚀 Starting DAMM v2 Fee Distributor Demo");

  // Configure the client to use the local cluster
  anchor.setProvider(anchor.AnchorProvider.env());
  const program = anchor.workspace.DammV2FeeDistributor as Program<DammV2FeeDistributor>;
  const provider = anchor.getProvider();

  // Generate test accounts
  const payer = Keypair.generate();
  const creator = Keypair.generate();
  const investor1 = Keypair.generate();
  const investor2 = Keypair.generate();
  const investor3 = Keypair.generate();

  console.log("📋 Generated test accounts:");
  console.log("  Payer:", payer.publicKey.toString());
  console.log("  Creator:", creator.publicKey.toString());
  console.log("  Investor 1:", investor1.publicKey.toString());
  console.log("  Investor 2:", investor2.publicKey.toString());
  console.log("  Investor 3:", investor3.publicKey.toString());

  // Airdrop SOL to accounts
  console.log("💰 Airdropping SOL to test accounts...");
  await provider.connection.requestAirdrop(payer.publicKey, 10 * anchor.web3.LAMPORTS_PER_SOL);
  await provider.connection.requestAirdrop(creator.publicKey, 10 * anchor.web3.LAMPORTS_PER_SOL);
  await provider.connection.requestAirdrop(investor1.publicKey, 10 * anchor.web3.LAMPORTS_PER_SOL);
  await provider.connection.requestAirdrop(investor2.publicKey, 10 * anchor.web3.LAMPORTS_PER_SOL);
  await provider.connection.requestAirdrop(investor3.publicKey, 10 * anchor.web3.LAMPORTS_PER_SOL);

  // Create token mints
  console.log("🪙 Creating token mints...");
  const quoteMint = await createMint(
    provider.connection,
    payer,
    payer.publicKey,
    null,
    6
  );

  const baseMint = await createMint(
    provider.connection,
    payer,
    payer.publicKey,
    null,
    6
  );

  console.log("  Quote Mint:", quoteMint.toString());
  console.log("  Base Mint:", baseMint.toString());

  // Generate pool and position IDs
  const poolId = Keypair.generate().publicKey;
  const positionId = Keypair.generate().publicKey;

  console.log("🏊 Pool ID:", poolId.toString());
  console.log("📍 Position ID:", positionId.toString());

  // Calculate PDAs
  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("investor_fee_config"), poolId.toBuffer()],
    program.programId
  );

  const [investorFeePositionOwnerPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), Buffer.from("vault"), Buffer.from("investor_fee_pos_owner")],
    program.programId
  );

  const [programAuthorityPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("program_authority")],
    program.programId
  );

  console.log("🔑 Calculated PDAs:");
  console.log("  Config PDA:", configPda.toString());
  console.log("  Position Owner PDA:", investorFeePositionOwnerPda.toString());
  console.log("  Program Authority PDA:", programAuthorityPda.toString());

  // Step 1: Initialize honorary position
  console.log("\n📝 Step 1: Initializing honorary position...");
  const tickLower = -1000;
  const tickUpper = 1000;

  try {
    const initTx = await program.methods
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

    console.log("✅ Honorary position initialized successfully!");
    console.log("  Transaction signature:", initTx);

    // Verify config account
    const configAccount = await program.account.configAccount.fetch(configPda);
    console.log("  Pool ID:", configAccount.poolId.toString());
    console.log("  Quote Mint:", configAccount.quoteMint.toString());
    console.log("  Tick Range:", configAccount.tickLower, "to", configAccount.tickUpper);
  } catch (error) {
    console.error("❌ Failed to initialize honorary position:", error);
    return;
  }

  // Step 2: Create ATAs and mint tokens
  console.log("\n🪙 Step 2: Setting up token accounts...");
  
  const programQuoteTreasury = await getAssociatedTokenAddress(quoteMint, programAuthorityPda, true);
  const creatorQuoteAta = await getAssociatedTokenAddress(quoteMint, creator.publicKey);
  const investor1QuoteAta = await getAssociatedTokenAddress(quoteMint, investor1.publicKey);
  const investor2QuoteAta = await getAssociatedTokenAddress(quoteMint, investor2.publicKey);
  const investor3QuoteAta = await getAssociatedTokenAddress(quoteMint, investor3.publicKey);

  // Create ATAs
  await createAccount(provider.connection, payer, quoteMint, creator.publicKey);
  await createAccount(provider.connection, payer, quoteMint, investor1.publicKey);
  await createAccount(provider.connection, payer, quoteMint, investor2.publicKey);
  await createAccount(provider.connection, payer, quoteMint, investor3.publicKey);

  // Mint tokens to program treasury for simulation
  await mintTo(
    provider.connection,
    payer,
    quoteMint,
    programQuoteTreasury,
    payer,
    10000000 // 10M tokens
  );

  console.log("✅ Token accounts created and funded");

  // Step 3: Simulate fee accrual
  console.log("\n💰 Step 3: Simulating fee accrual...");
  console.log("  Program treasury balance: 10,000,000 tokens");
  console.log("  (In production, this would come from cp-amm fee claims)");

  // Step 4: Run crank distribution
  console.log("\n⚙️ Step 4: Running crank distribution...");

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
  const currentTime = Math.floor(Date.now() / 1000);
  const dayId = Math.floor(currentTime / 86400);
  const [progressPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("investor_fee_progress"), Buffer.from(dayId.toString())],
    program.programId
  );

  try {
    const crankTx = await program.methods
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

    console.log("✅ Crank distribution completed successfully!");
    console.log("  Transaction signature:", crankTx);

    // Verify progress account
    const progressAccount = await program.account.progressAccount.fetch(progressPda);
    console.log("  Day ID:", progressAccount.dayId.toString());
    console.log("  Claimed Quote:", progressAccount.claimedQuoteForDay.toString());
    console.log("  Distributed Today:", progressAccount.cumulativeDistributedToday.toString());
    console.log("  Carry Over:", progressAccount.carryOver.toString());
    console.log("  Pagination Cursor:", progressAccount.paginationCursor.toString());

  } catch (error) {
    console.error("❌ Failed to run crank distribution:", error);
    return;
  }

  // Step 5: Test pagination
  console.log("\n📄 Step 5: Testing pagination...");

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

  // Calculate progress PDA for tomorrow
  const tomorrowDayId = Math.floor(currentTime / 86400) + 1;
  const [tomorrowProgressPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("investor_fee_progress"), Buffer.from(tomorrowDayId.toString())],
    program.programId
  );

  try {
    // First page
    const page1Tx = await program.methods
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
        progress: tomorrowProgressPda,
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

    console.log("✅ Page 1 processed:", page1Tx);

    // Second page (final)
    const page2Tx = await program.methods
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
        progress: tomorrowProgressPda,
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

    console.log("✅ Page 2 processed:", page2Tx);

    // Verify final progress
    const finalProgressAccount = await program.account.progressAccount.fetch(tomorrowProgressPda);
    console.log("  Final pagination cursor:", finalProgressAccount.paginationCursor.toString());

  } catch (error) {
    console.error("❌ Failed to test pagination:", error);
    return;
  }

  console.log("\n🎉 Demo completed successfully!");
  console.log("\n📊 Summary:");
  console.log("  ✅ Honorary position initialized");
  console.log("  ✅ Fee distribution crank executed");
  console.log("  ✅ Pagination tested");
  console.log("  ✅ All tests passed");
}

main().catch((error) => {
  console.error("💥 Demo failed:", error);
  process.exit(1);
});