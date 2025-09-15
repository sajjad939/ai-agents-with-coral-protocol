# Blockchain Logging Integration

## Overview

The QAaaS platform includes a blockchain logging integration that provides immutable, verifiable records of test results. This document explains how the blockchain logging works and how to configure it.

## Architecture

The blockchain logging integration uses a combination of:

1. **IPFS Storage** (via NFT.Storage) - For storing the full test results data
2. **Solana Blockchain** - For storing references to the IPFS data, providing an immutable timestamp and verification
3. **Local Backup** - For redundancy and offline access to test results

## Configuration

To enable blockchain logging, you need to configure the following environment variables:

```
# Blockchain Configuration
SOLANA_ENDPOINT=https://api.devnet.solana.com
SOLANA_PROGRAM_ID=your_solana_program_id_here
SOLANA_PRIVATE_KEY=your_solana_private_key_here

# Storage Configuration
NFT_STORAGE_API_KEY=your_nft_storage_api_key_here
```

### Getting the Required Keys

1. **NFT.Storage API Key**:
   - Sign up at [https://nft.storage](https://nft.storage)
   - Create a new API key in your account dashboard

2. **Solana Program ID**:
   - This is the address of the deployed Solana program that will record the test results
   - For development, you can use a placeholder value, and the system will fall back to local storage only

3. **Solana Private Key**:
   - This is the private key used to sign transactions
   - For development, you can use a placeholder value

## Fallback Behavior

The blockchain logging system is designed to be resilient and will fall back gracefully if components are unavailable:

1. If the NFT.Storage API key is invalid or missing, the system will skip IPFS storage and only save results locally
2. If the Solana program ID is invalid or missing, the system will skip blockchain logging but still attempt IPFS storage
3. Local backups are always created regardless of the success of IPFS or blockchain logging

## Handling Empty Repositories

When testing empty repositories (those with only a .git directory), the system will:

1. Detect the empty repository condition
2. Skip running actual tests
3. Generate a standardized test result indicating the repository was empty
4. Log these results to blockchain (if configured) just like any other test result

## Retrieving Test Results

Test results can be retrieved in several ways:

1. **API Endpoint**: `/api/results/:repoId` will return all test results for a specific repository
2. **Local Files**: Check the `blockchain_logs` directory for local backups
3. **IPFS Gateway**: If IPFS storage was successful, results can be accessed via the URL: `https://{cid}.ipfs.nftstorage.link`

## Example Usage

```javascript
const blockchainLogger = new BlockchainLogger({
  solanaEndpoint: process.env.SOLANA_ENDPOINT,
  programId: process.env.SOLANA_PROGRAM_ID,
  ipfsApiKey: process.env.NFT_STORAGE_API_KEY
});

const logResult = await blockchainLogger.logResults(
  testResults,  // The test results object
  'unit',        // Type of test ('unit' or 'integration')
  'repo-123'     // Repository identifier
);

console.log('Results logged:', logResult.storage?.url || 'Local only');
```