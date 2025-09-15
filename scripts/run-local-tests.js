#!/usr/bin/env node

/**
 * run-local-tests.js
 * 
 * Helper script to run the QAaaS pipeline locally for testing purposes.
 * This script demonstrates how to use the agents to clone a repository,
 * run tests, and log results to the blockchain.
 */

require('dotenv').config();
const path = require('path');
const fs = require('fs-extra');
const { program } = require('commander');

// Import agents
const RepoClonerAgent = require('../agents/repoClonerAgent');
const UnitTestAgent = require('../agents/unitTestAgent');
const IntegrationAgent = require('../agents/integrationAgent');
const BlockchainLogger = require('../agents/blockchainLogger');

// Configure CLI options
program
  .name('run-local-tests')
  .description('Run QAaaS pipeline locally for testing')
  .version('1.0.0')
  .requiredOption('-r, --repo <url>', 'Repository URL to clone')
  .option('-b, --branch <name>', 'Branch to checkout', 'main')
  .option('-a, --auth <token>', 'Authentication token for private repositories')
  .option('-t, --test-type <type>', 'Type of tests to run (unit, integration, all)', 'all')
  .option('-o, --output <path>', 'Path to save results', './test-results')
  .option('--blockchain', 'Log results to blockchain', false)
  .option('--cleanup', 'Remove cloned repository after tests', false)
  .parse();

const options = program.opts();

// Main function to run the pipeline
async function runPipeline() {
  console.log('🚀 Starting QAaaS pipeline...');
  console.log('Repository:', options.repo);
  console.log('Branch:', options.branch);
  console.log('Test type:', options.testType);
  
  // Create output directory if it doesn't exist
  fs.ensureDirSync(options.output);
  
  try {
    // Step 1: Clone repository
    console.log('\n📦 Cloning repository...');
    const repoClonerAgent = new RepoClonerAgent();
    const cloneResult = await repoClonerAgent.cloneRepository({
      repoUrl: options.repo,
      branch: options.branch,
      accessToken: options.auth,
      repoId: `repo-${Date.now()}`
    });
    console.log('Repository cloned successfully:', cloneResult.path);
    
    // Initialize results object
    const results = {
      repoId: cloneResult.repoId,
      repoUrl: options.repo,
      branch: options.branch,
      timestamp: new Date().toISOString(),
      unitTests: null,
      integrationTests: null
    };
    
    // Step 2: Run unit tests if requested
    if (options.testType === 'unit' || options.testType === 'all') {
      console.log('\n🧪 Running unit tests...');
      const unitTestAgent = new UnitTestAgent();
      const unitTestResults = await unitTestAgent.runTests({
        repoPath: cloneResult.path,
        testType: 'unit'
      });
      
      console.log(`Unit tests completed: ${unitTestResults.passed} passed, ${unitTestResults.failed} failed`);
      results.unitTests = unitTestResults;
      
      // Log unit test results to blockchain if requested
      if (options.blockchain) {
        console.log('\n🔗 Logging unit test results to blockchain...');
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
        
        console.log('Unit test results logged to blockchain:', unitLogResult.storage?.url || 'Local only');
        results.unitTests.blockchain = unitLogResult;
      }
    }
    
    // Step 3: Run integration tests if requested
    if (options.testType === 'integration' || options.testType === 'all') {
      console.log('\n🔄 Running integration tests...');
      const integrationAgent = new IntegrationAgent();
      const integrationTestResults = await integrationAgent.runTests({
        repoPath: cloneResult.path,
        testType: 'integration'
      });
      
      console.log(`Integration tests completed: ${integrationTestResults.passed} passed, ${integrationTestResults.failed} failed`);
      results.integrationTests = integrationTestResults;
      
      // Log integration test results to blockchain if requested
      if (options.blockchain) {
        console.log('\n🔗 Logging integration test results to blockchain...');
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
        
        console.log('Integration test results logged to blockchain:', integrationLogResult.storage?.url || 'Local only');
        results.integrationTests.blockchain = integrationLogResult;
      }
    }
    
    // Step 4: Save results to file
    const resultsPath = path.join(options.output, `${cloneResult.repoId}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    fs.writeJsonSync(resultsPath, results, { spaces: 2 });
    console.log(`\n💾 Results saved to ${resultsPath}`);
    
    // Step 5: Cleanup if requested
    if (options.cleanup) {
      console.log('\n🧹 Cleaning up...');
      // Add a small delay before cleanup to ensure all file handles are released
      await new Promise(resolve => setTimeout(resolve, 1000));
      await fs.remove(cloneResult.path);
      console.log('Repository removed');
    }
    
    console.log('\n✅ QAaaS pipeline completed successfully!');
    return results;
  } catch (error) {
    console.error('❌ Error running QAaaS pipeline:', error);
    process.exit(1);
  }
}

// Run the pipeline
runPipeline();