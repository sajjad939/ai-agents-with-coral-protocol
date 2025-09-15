/**
 * QAaaS Backend System
 * 
 * This is the main entry point for the QAaaS backend system, which provides
 * automated testing capabilities with blockchain-verified results.
 */

require('dotenv').config();
const express = require('express');
const fs = require('fs-extra');
const path = require('path');

// Import agents
const RepoClonerAgent = require('./agents/repoClonerAgent');
const UnitTestAgent = require('./agents/unitTestAgent');
const IntegrationAgent = require('./agents/integrationAgent');
const BlockchainLogger = require('./agents/blockchainLogger');

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());

// Ensure required directories exist
fs.ensureDirSync(path.join(__dirname, 'repos'));
fs.ensureDirSync(path.join(__dirname, 'blockchain_logs'));

// Routes
app.get('/', (req, res) => {
  res.json({
    name: 'QAaaS Backend',
    version: '1.0.0',
    status: 'running'
  });
});

// API endpoint to run the QA pipeline
app.post('/api/run-tests', async (req, res) => {
  try {
    const { repoUrl, branch = 'main', auth, testTypes = ['unit', 'integration'] } = req.body;
    
    if (!repoUrl) {
      return res.status(400).json({ error: 'Repository URL is required' });
    }
    
    // Step 1: Clone repository
    const repoClonerAgent = new RepoClonerAgent();
    const cloneResult = await repoClonerAgent.cloneRepository({
      url: repoUrl,
      branch,
      auth: auth ? { type: 'token', token: auth } : undefined
    });
    
    const results = {
      repoId: cloneResult.repoId,
      repoUrl,
      branch,
      timestamp: new Date().toISOString(),
      unitTests: null,
      integrationTests: null
    };
    
    // Step 2: Run unit tests if requested
    if (testTypes.includes('unit')) {
      const unitTestAgent = new UnitTestAgent();
      const unitTestResults = await unitTestAgent.runTests({
        repoPath: cloneResult.path,
        testType: 'unit'
      });
      
      results.unitTests = unitTestResults;
      
      // Log unit test results to blockchain
      const blockchainLogger = new BlockchainLogger({
        solanaEndpoint: process.env.SOLANA_ENDPOINT || 'https://api.devnet.solana.com',
        programId: process.env.SOLANA_PROGRAM_ID,
        ipfsApiKey: process.env.NFT_STORAGE_API_KEY
      });
      
      const unitLogResult = await blockchainLogger.logResults(
        unitTestResults,
        'unit',
        cloneResult.repoId
      );
      
      results.unitTests.blockchain = unitLogResult;
    }
    
    // Step 3: Run integration tests if requested
    if (testTypes.includes('integration')) {
      const integrationAgent = new IntegrationAgent();
      const integrationTestResults = await integrationAgent.runTests({
        repoPath: cloneResult.path,
        testType: 'integration'
      });
      
      results.integrationTests = integrationTestResults;
      
      // Log integration test results to blockchain
      const blockchainLogger = new BlockchainLogger({
        solanaEndpoint: process.env.SOLANA_ENDPOINT || 'https://api.devnet.solana.com',
        programId: process.env.SOLANA_PROGRAM_ID,
        ipfsApiKey: process.env.NFT_STORAGE_API_KEY
      });
      
      const integrationLogResult = await blockchainLogger.logResults(
        integrationTestResults,
        'integration',
        cloneResult.repoId
      );
      
      results.integrationTests.blockchain = integrationLogResult;
    }
    
    // Return results
    res.json(results);
    
    // Cleanup repository asynchronously
    fs.remove(cloneResult.path).catch(err => {
      console.error('Error cleaning up repository:', err);
    });
  } catch (error) {
    console.error('Error running tests:', error);
    res.status(500).json({ error: error.message });
  }
});

// API endpoint to retrieve test results by repo ID
app.get('/api/results/:repoId', async (req, res) => {
  try {
    const { repoId } = req.params;
    
    const blockchainLogger = new BlockchainLogger();
    const results = await blockchainLogger.getResultsForRepo(repoId);
    
    if (results.length === 0) {
      return res.status(404).json({ error: 'No results found for this repository' });
    }
    
    res.json(results);
  } catch (error) {
    console.error('Error retrieving results:', error);
    res.status(500).json({ error: error.message });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`QAaaS Backend server running on port ${PORT}`);
});

module.exports = app; // Export for testing