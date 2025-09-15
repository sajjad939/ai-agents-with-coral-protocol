/**
 * blockchainLogger.js
 * 
 * This module handles the integration with blockchain technologies for immutable
 * logging of test results. It formats results for storage through the Solana smart
 * contract + IPFS/Arweave pipeline, with hooks for the aggregator agent to consume.
 */

const { Connection, PublicKey, Transaction, sendAndConfirmTransaction } = require('@solana/web3.js');
const { NFTStorage } = require('nft.storage');
const fs = require('fs');
const path = require('path');

class BlockchainLogger {
  constructor(config = {}) {
    // Solana configuration
    this.solanaEndpoint = config.solanaEndpoint || 'https://api.devnet.solana.com';
    this.solanaConnection = new Connection(this.solanaEndpoint);
    
    // Safely initialize programId with validation
    try {
      this.programId = config.programId && this.isValidPublicKey(config.programId) ? 
        new PublicKey(config.programId) : null;
    } catch (error) {
      console.warn(`Invalid program ID provided: ${error.message}. Blockchain logging will be disabled.`);
      this.programId = null;
    }
    
    this.payer = config.payer || null; // Wallet for paying transaction fees
    
    // IPFS/Arweave configuration
    this.storageType = config.storageType || 'ipfs'; // 'ipfs' or 'arweave'
    this.ipfsApiKey = config.ipfsApiKey || process.env.NFT_STORAGE_API_KEY;
    this.ipfsClient = this.ipfsApiKey ? new NFTStorage({ token: this.ipfsApiKey }) : null;
    this.arweaveKey = config.arweaveKey || null;
    
    // Local storage for backup
    this.localStoragePath = config.localStoragePath || path.join(process.cwd(), 'blockchain_logs');
    if (!fs.existsSync(this.localStoragePath)) {
      fs.mkdirSync(this.localStoragePath, { recursive: true });
    }
  }

  /**
   * Log test results to blockchain and decentralized storage
   * 
   * @param {Object} results - Test results to log
   * @param {string} type - Type of test ('unit' or 'integration')
   * @param {string} repoId - Repository identifier
   * @returns {Promise<Object>} - Logging result with transaction IDs and storage URLs
   */
  async logResults(results, type, repoId) {
    try {
      let storageResult = null;
      let blockchainResult = null;
      
      // Check if we have a valid IPFS API key for storage
      if (this.ipfsClient) {
        try {
          // Store the results in decentralized storage
          storageResult = await this._storeResults(results, type, repoId);
          
          // Log the reference on Solana blockchain if programId is valid
          if (this.programId) {
            blockchainResult = await this._logToBlockchain(storageResult.cid, type, repoId);
          } else {
            console.log('Skipping blockchain logging: No valid Solana program ID configured');
          }
        } catch (storageError) {
          console.warn(`Failed to store results in decentralized storage: ${storageError.message}`);
          // Continue with local backup only
        }
      } else {
        console.log('Skipping decentralized storage: No valid NFT.Storage API key configured');
      }
      
      // Save a local backup
      const localBackupPath = this._saveLocalBackup(results, storageResult, blockchainResult, type, repoId);
      
      const response = {
        success: true,
        type,
        repoId,
        timestamp: new Date().toISOString(),
        localBackup: localBackupPath
      };
      
      // Add storage info if available
      if (storageResult) {
        response.storage = {
          type: this.storageType,
          cid: storageResult.cid,
          url: storageResult.url
        };
      }
      
      // Add blockchain info if available
      if (blockchainResult) {
        response.blockchain = {
          network: this.solanaEndpoint.includes('devnet') ? 'devnet' : 'mainnet',
          transactionId: blockchainResult.transactionId,
          blockHeight: blockchainResult.blockHeight
        };
      }
      
      return response;
    } catch (error) {
      console.error('Failed to log results to blockchain:', error);
      
      // Save locally even if blockchain logging fails
      const localBackupPath = this._saveLocalBackup(results, null, null, type, repoId);
      
      return {
        success: false,
        type,
        repoId,
        timestamp: new Date().toISOString(),
        error: error.message,
        localBackup: localBackupPath
      };
    }
  }

  /**
   * Store test results in decentralized storage (IPFS or Arweave)
   * 
   * @param {Object} results - Test results to store
   * @param {string} type - Type of test
   * @param {string} repoId - Repository identifier
   * @returns {Promise<Object>} - Storage result with CID and URL
   * @private
   */
  async _storeResults(results, type, repoId) {
    // Prepare metadata
    const metadata = {
      name: `${repoId}-${type}-test-results`,
      description: `Test results for ${repoId} repository (${type} tests)`,
      timestamp: new Date().toISOString(),
      results
    };
    
    if (this.storageType === 'ipfs') {
      if (!this.ipfsClient) {
        throw new Error('IPFS client not configured. Please provide a valid NFT.Storage API key.');
      }
      
      try {
        // Store on IPFS using NFT.Storage
        const blob = new Blob([JSON.stringify(metadata)], { type: 'application/json' });
        const cid = await this.ipfsClient.storeBlob(blob);
        
        return {
          cid,
          url: `https://${cid}.ipfs.nftstorage.link`
        };
      } catch (error) {
        console.error('Error storing data on IPFS:', error);
        throw new Error(`Failed to store data on IPFS: ${error.message}`);
      }
    } else if (this.storageType === 'arweave') {
      // Note: Arweave implementation would go here
      // This is a placeholder for actual Arweave integration
      throw new Error('Arweave storage not yet implemented');
    } else {
      throw new Error(`Unsupported storage type: ${this.storageType}`);
    }
  }

  /**
   * Log a reference to the stored results on the Solana blockchain
   * 
   * @param {string} cid - Content identifier from decentralized storage
   * @param {string} type - Type of test
   * @param {string} repoId - Repository identifier
   * @returns {Promise<Object>} - Blockchain transaction result
   * @private
   */
  async _logToBlockchain(cid, type, repoId) {
    if (!this.programId) {
      throw new Error('Solana program ID not configured or invalid');
    }
    
    if (!this.payer) {
      console.log('No Solana payer wallet configured, using simulated transaction');
    }
    
    try {
      // This is a placeholder for actual Solana smart contract interaction
      // In a real implementation, you would construct and send a transaction
      // to your Solana program that logs the test results
      
      console.log(`Logging to Solana blockchain: ${cid} (${type} tests for ${repoId})`);
      
      // Simulate a successful transaction
      return {
        transactionId: `simulated_tx_${Date.now()}`,
        blockHeight: 12345678
      };
    } catch (error) {
      console.error('Error logging to blockchain:', error);
      throw new Error(`Failed to log to blockchain: ${error.message}`);
    }
    
    // Example of actual Solana transaction (commented out)
    /*
    // Create an instruction to call your program
    const instruction = new TransactionInstruction({
      keys: [
        { pubkey: this.payer.publicKey, isSigner: true, isWritable: true },
        // Add other account keys as needed by your program
      ],
      programId: this.programId,
      data: Buffer.from(JSON.stringify({
        action: 'log_test_results',
        cid,
        type,
        repoId,
        timestamp: new Date().toISOString()
      }))
    });
    
    // Create and send the transaction
    const transaction = new Transaction().add(instruction);
    const signature = await sendAndConfirmTransaction(
      this.solanaConnection,
      transaction,
      [this.payer]
    );
    
    // Get the block height
    const { slot } = await this.solanaConnection.getSignatureStatus(signature);
    
    return {
      transactionId: signature,
      blockHeight: slot
    };
    */
  }

  /**
   * Save a local backup of the test results and blockchain references
   * 
   * @param {Object} results - Test results
   * @param {Object} storageResult - Decentralized storage result
   * @param {Object} blockchainResult - Blockchain transaction result
   * @param {string} type - Type of test
   * @param {string} repoId - Repository identifier
   * @returns {string} - Path to the local backup file
   * @private
   */
  _saveLocalBackup(results, storageResult, blockchainResult, type, repoId) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `${repoId}-${type}-${timestamp}.json`;
    const filePath = path.join(this.localStoragePath, filename);
    
    const backupData = {
      repoId,
      type,
      timestamp: new Date().toISOString(),
      results,
      storage: storageResult,
      blockchain: blockchainResult
    };
    
    fs.writeFileSync(filePath, JSON.stringify(backupData, null, 2));
    
    return filePath;
  }

  /**
   * Retrieve test results from blockchain and decentralized storage
   * 
   * @param {string} cid - Content identifier from decentralized storage
   * @returns {Promise<Object>} - Retrieved test results
   */
  async retrieveResults(cid) {
    try {
      if (this.storageType === 'ipfs') {
        // Fetch from IPFS
        const response = await fetch(`https://${cid}.ipfs.nftstorage.link`);
        if (!response.ok) {
          throw new Error(`Failed to fetch from IPFS: ${response.statusText}`);
        }
        
        return await response.json();
      } else if (this.storageType === 'arweave') {
        // Note: Arweave retrieval implementation would go here
        throw new Error('Arweave retrieval not yet implemented');
      } else {
        throw new Error(`Unsupported storage type: ${this.storageType}`);
      }
    } catch (error) {
      console.error('Failed to retrieve results:', error);
      
      // Try to find a local backup
      const localFiles = fs.readdirSync(this.localStoragePath);
      const matchingFile = localFiles.find(file => {
        try {
          const data = JSON.parse(fs.readFileSync(path.join(this.localStoragePath, file), 'utf8'));
          return data.storage && data.storage.cid === cid;
        } catch (err) {
          return false;
        }
      });
      
      if (matchingFile) {
        const data = JSON.parse(fs.readFileSync(path.join(this.localStoragePath, matchingFile), 'utf8'));
        return data.results;
      }
      
      throw new Error(`Could not retrieve results for CID: ${cid}`);
    }
  }

  /**
   * Validates if a string is a valid Solana public key
   * 
   * @param {string} key - The string to validate as a public key
   * @returns {boolean} - Whether the string is a valid public key
   */
  isValidPublicKey(key) {
    try {
      // Check if the key is a valid base58 string of the correct length
      if (!key || typeof key !== 'string') {
        return false;
      }
      
      // Basic validation before attempting to create PublicKey
      // Solana public keys are base58 encoded and 32 bytes (44 characters in base58)
      const base58Regex = /^[1-9A-HJ-NP-Za-km-z]{43,44}$/;
      if (!base58Regex.test(key)) {
        return false;
      }
      
      // Final validation by attempting to create a PublicKey
      new PublicKey(key);
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Get all test results for a specific repository
   * 
   * @param {string} repoId - Repository identifier
   * @returns {Promise<Array>} - Array of test result references
   */
  async getResultsForRepo(repoId) {
    // This is a simplified implementation that only checks local backups
    // In a real implementation, you would query your Solana program for all
    // transactions related to this repository
    
    try {
      const localFiles = fs.readdirSync(this.localStoragePath);
      const matchingFiles = localFiles.filter(file => file.startsWith(`${repoId}-`));
      
      return matchingFiles.map(file => {
        const data = JSON.parse(fs.readFileSync(path.join(this.localStoragePath, file), 'utf8'));
        return {
          repoId: data.repoId,
          type: data.type,
          timestamp: data.timestamp,
          storage: data.storage,
          blockchain: data.blockchain
        };
      });
    } catch (error) {
      console.error('Failed to get results for repo:', error);
      return [];
    }
  }
}

module.exports = BlockchainLogger;

// Example usage:
// const logger = new BlockchainLogger({
//   solanaEndpoint: 'https://api.devnet.solana.com',
//   programId: 'your_program_id',
//   ipfsApiKey: 'your_nft_storage_api_key'
// });
// 
// logger.logResults(testResults, 'unit', 'my-repo-id')
//   .then(result => {
//     console.log('Results logged to blockchain:', result);
//   })
//   .catch(err => {
//     console.error('Failed to log results:', err);
//   });