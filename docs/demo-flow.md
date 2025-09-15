# QAaaS Pipeline Demo Flow

## Overview

This document outlines the workflow of the QAaaS (Quality Assurance as a Service) backend system, which provides automated testing capabilities with blockchain-verified results. The system consists of several agents that work together to clone repositories, run tests, and log results to the blockchain.

## Architecture

The QAaaS backend system is built on a modular architecture with the following components:

1. **Repo Cloner Agent**: Securely clones target repositories for testing
2. **Unit Test Agent**: Runs unit tests on the cloned repository
3. **Integration Test Agent**: Executes integration tests across multiple modules
4. **Blockchain Logger**: Records test results to Solana blockchain and IPFS/Arweave

![QAaaS Architecture](https://mermaid.ink/img/pako:eNp1kU1PwzAMhv9KlBOgSf3YpE1w2A6cEBJiB8QOaRpaNrJkShJtRdX_TttNMG3ixSf7fWzHPkCuNUECJZvXjVQGX6XCjWA1Wd1KZVvFDLJGNxY_pLRk0VhkQqOxXYvs0bA1MqHwU6iKrO6QHfnS6I6ZkKpWXKDVJTJhcFPrGhkzxnXTIRNbVFxpw4RUFTLWqB2yB8EbZA-VVMge91xvkT1VQrXIXoTgDZdnzFjXtUxYrjRX5xnzXDfIXoVskL0JVSGTWp2vZzgbTWcwHo_vYAQJjGAMCUxgCimkMIMM7iGHBSxhBY_wBM_wAq_wBu_wAZ_wBd_wAz_rP3-HMjtu90ZZW-rh4-S0Y7Lf7_cDOVTWHvaDru8PB_0wHITBMByGYXj6BZEHtNc?type=png)

## Workflow

### 1. Repository Connection

Developers connect their repository to the QAaaS system by providing:
- Repository URL (GitHub/GitLab)
- Authentication credentials (if private)
- Branch to test
- Test configuration options

### 2. Repository Cloning

The **Repo Cloner Agent** securely clones the repository:

```javascript
const repoClonerAgent = new RepoClonerAgent();
const cloneResult = await repoClonerAgent.cloneRepository({
  url: 'https://github.com/username/repo.git',
  branch: 'main',
  auth: { type: 'token', token: 'github_token' }
});
```

### 3. Unit Testing

The **Unit Test Agent** automatically detects the project type and runs appropriate unit tests:

```javascript
const unitTestAgent = new UnitTestAgent();
const unitTestResults = await unitTestAgent.runTests({
  repoPath: cloneResult.path,
  testType: 'unit'
});
```

The Unit Test Agent handles various project types including:
- JavaScript/Node.js (Jest, Mocha, etc.)
- Python (pytest, unittest)
- Java (JUnit, TestNG)
- And more...

It also gracefully handles edge cases such as empty repositories, providing standardized results that can still be logged to the blockchain.

### 4. Integration Testing

The **Integration Test Agent** runs tests that verify interactions between modules:

```javascript
const integrationAgent = new IntegrationAgent();
const integrationTestResults = await integrationAgent.runTests({
  repoPath: cloneResult.path,
  testType: 'integration'
});
```

The Integration Test Agent supports various testing frameworks including:
- Cypress
- Playwright
- Jest with DOM testing
- Mocha with Supertest
- Selenium (Python, Java)
- And more...

Like the Unit Test Agent, it also handles empty repositories and other edge cases gracefully, ensuring consistent results for the blockchain logging system.

### 5. Blockchain Logging

Test results are logged to the blockchain for immutable verification:

```javascript
const blockchainLogger = new BlockchainLogger({
  solanaEndpoint: 'https://api.devnet.solana.com',
  programId: 'your_program_id',
  ipfsApiKey: 'your_nft_storage_api_key'
});

// Log unit test results
const unitLogResult = await blockchainLogger.logResults(
  unitTestResults,
  'unit',
  cloneResult.repoId
);

// Log integration test results
const integrationLogResult = await blockchainLogger.logResults(
  integrationTestResults,
  'integration',
  cloneResult.repoId
);
```

The blockchain logging system provides:

- **Immutable Records**: Test results cannot be altered once recorded
- **Decentralized Storage**: Full test results stored on IPFS
- **Verification**: Blockchain timestamps provide proof of when tests were run
- **Fallback Mechanisms**: Local backups ensure results are never lost

For detailed information about the blockchain logging integration, see [blockchain-logging.md](./blockchain-logging.md).

### 6. Results Aggregation

The Aggregator Agent (not included in this implementation) collects and processes all test results for presentation in the QAaaS dashboard.

## Deployment

The QAaaS backend system can be deployed using Docker:

```bash
# Build and start the containers
docker-compose up -d

# View logs
docker-compose logs -f

# Stop the containers
docker-compose down
```

## Local Development

To run the QAaaS backend system locally:

1. Clone the QAaaS repository
2. Install dependencies: `npm install`
3. Set up environment variables in a `.env` file
4. Run the system: `node index.js`

## Example Flow

Here's a complete example of how the QAaaS pipeline processes a repository:

```javascript
// 1. Clone the repository
const repoClonerAgent = new RepoClonerAgent();
const cloneResult = await repoClonerAgent.cloneRepository({
  url: 'https://github.com/username/repo.git',
  branch: 'main',
  auth: { type: 'token', token: process.env.GITHUB_TOKEN }
});

// 2. Run unit tests
const unitTestAgent = new UnitTestAgent();
const unitTestResults = await unitTestAgent.runTests({
  repoPath: cloneResult.path,
  testType: 'unit'
});

// 3. Run integration tests
const integrationAgent = new IntegrationAgent();
const integrationTestResults = await integrationAgent.runTests({
  repoPath: cloneResult.path,
  testType: 'integration'
});

// 4. Log results to blockchain
const blockchainLogger = new BlockchainLogger({
  solanaEndpoint: process.env.SOLANA_ENDPOINT,
  programId: process.env.SOLANA_PROGRAM_ID,
  ipfsApiKey: process.env.NFT_STORAGE_API_KEY
});

const unitLogResult = await blockchainLogger.logResults(
  unitTestResults,
  'unit',
  cloneResult.repoId
);

const integrationLogResult = await blockchainLogger.logResults(
  integrationTestResults,
  'integration',
  cloneResult.repoId
);

// 5. Return combined results
return {
  repoId: cloneResult.repoId,
  unitTests: {
    results: unitTestResults,
    blockchain: unitLogResult
  },
  integrationTests: {
    results: integrationTestResults,
    blockchain: integrationLogResult
  }
};
```

## Benefits

- **Automated Testing**: No manual setup required
- **Blockchain Verification**: Immutable proof of test results
- **Standardized Output**: Consistent JSON format for all test results
- **Containerized Deployment**: Easy to deploy and scale
- **Language Agnostic**: Supports multiple programming languages and test frameworks

## Conclusion

The QAaaS backend system provides a robust, automated testing pipeline with blockchain verification. By connecting their repositories, developers can quickly get standardized test results with the assurance that these results are immutably logged on the blockchain for future reference and verification.