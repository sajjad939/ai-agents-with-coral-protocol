/**
 * unitTestAgent.js
 * 
 * This agent is responsible for running unit tests automatically after repo cloning.
 * It detects the project type (Node.js, Python, etc.), executes the corresponding
 * test framework (e.g., Jest, Mocha, PyTest), and outputs structured results in
 * JSON format for downstream aggregation.
 */

const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const util = require('util');

// Promisify exec for async/await usage
const execAsync = util.promisify(exec);

class UnitTestAgent {
  constructor(config = {}) {
    this.timeout = config.timeout || 600000; // 10 minutes default timeout
    this.coralProtocolEndpoint = config.coralProtocolEndpoint || 'http://localhost:3000/api/coral';
  }

  /**
   * Run unit tests for a repository
   * 
   * @param {Object} params - Test parameters
   * @param {string} params.repoPath - Path to the repository
   * @param {string} params.repoId - Unique identifier for this repository
   * @param {string} params.testCommand - Optional specific test command to run
   * @returns {Promise<Object>} - Test results in standardized format
   */
  async runTests(params) {
    const { repoPath, repoId, testCommand } = params;
    
    if (!repoPath || !fs.existsSync(repoPath)) {
      throw new Error(`Repository path does not exist: ${repoPath}`);
    }

    try {
      // Notify Coral Protocol that testing has started
      await this._notifyCoralProtocol({
        status: 'started',
        repoId,
        action: 'unit_test',
        timestamp: new Date().toISOString()
      });

      // Detect project type and determine test command
      const projectType = await this._detectProjectType(repoPath);
      const command = testCommand || await this._determineTestCommand(repoPath, projectType);
      
      if (!command) {
        throw new Error(`Could not determine test command for project type: ${projectType}`);
      }

      // Execute test command
      console.log(`Running test command: ${command}`);
      const { stdout, stderr } = await execAsync(command, { 
        cwd: repoPath,
        timeout: this.timeout,
        maxBuffer: 10 * 1024 * 1024 // 10MB buffer for large test outputs
      });

      // Parse test results into standardized format
      const results = this._parseTestResults(stdout, stderr, projectType);
      
      // Notify Coral Protocol about test completion
      await this._notifyCoralProtocol({
        status: 'completed',
        repoId,
        action: 'unit_test',
        results: results.summary,
        timestamp: new Date().toISOString()
      });

      return results;
    } catch (error) {
      // Notify Coral Protocol about test failure
      await this._notifyCoralProtocol({
        status: 'error',
        repoId,
        action: 'unit_test',
        error: error.message,
        timestamp: new Date().toISOString()
      });
      
      throw new Error(`Failed to run unit tests: ${error.message}`);
    }
  }

  /**
   * Detect the type of project in the repository
   * 
   * @param {string} repoPath - Path to the repository
   * @returns {Promise<string>} - Detected project type
   * @private
   */
  async _detectProjectType(repoPath) {
    // Check for package.json (Node.js)
    if (fs.existsSync(path.join(repoPath, 'package.json'))) {
      const packageJson = JSON.parse(fs.readFileSync(path.join(repoPath, 'package.json'), 'utf8'));
      
      // Check for specific frameworks in dependencies
      const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };
      
      if (deps.jest) return 'jest';
      if (deps.mocha) return 'mocha';
      if (deps.karma) return 'karma';
      
      return 'node';
    }
    
    // Check for requirements.txt or setup.py (Python)
    if (fs.existsSync(path.join(repoPath, 'requirements.txt')) || 
        fs.existsSync(path.join(repoPath, 'setup.py'))) {
      // Check for specific test frameworks
      try {
        const files = await fs.promises.readdir(repoPath);
        if (files.some(file => file.includes('pytest'))) return 'pytest';
        if (files.some(file => file.includes('unittest'))) return 'unittest';
      } catch (err) {
        console.error('Error reading directory:', err);
      }
      
      return 'python';
    }
    
    // Check for pom.xml (Java/Maven)
    if (fs.existsSync(path.join(repoPath, 'pom.xml'))) {
      return 'maven';
    }
    
    // Check for build.gradle (Java/Gradle)
    if (fs.existsSync(path.join(repoPath, 'build.gradle'))) {
      return 'gradle';
    }
    
    // Check for Cargo.toml (Rust)
    if (fs.existsSync(path.join(repoPath, 'Cargo.toml'))) {
      return 'rust';
    }
    
    // Check for go.mod (Go)
    if (fs.existsSync(path.join(repoPath, 'go.mod'))) {
      return 'go';
    }
    
    // Check if repository is empty (only contains .git directory)
    try {
      const files = await fs.promises.readdir(repoPath);
      const nonGitFiles = files.filter(file => file !== '.git');
      if (nonGitFiles.length === 0) {
        console.warn('Repository appears to be empty (only contains .git directory)');
        return 'empty';
      }
    } catch (err) {
      console.error('Error checking repository contents:', err);
    }
    
    // Default to unknown
    return 'unknown';
  }

  /**
   * Determine the appropriate test command based on project type
   * 
   * @param {string} repoPath - Path to the repository
   * @param {string} projectType - Type of project detected
   * @returns {Promise<string>} - Test command to execute
   * @private
   */
  async _determineTestCommand(repoPath, projectType) {
    switch (projectType) {
      case 'empty':
        console.log('Repository is empty, skipping tests');
        return 'echo "Repository is empty, no tests to run"';
      case 'jest':
        return 'npx jest --json';
      
      case 'mocha':
        return 'npx mocha --reporter json';
      
      case 'karma':
        return 'npx karma start --single-run --reporters json';
      
      case 'node':
        // Check if there's a test script in package.json
        try {
          const packageJson = JSON.parse(fs.readFileSync(path.join(repoPath, 'package.json'), 'utf8'));
          if (packageJson.scripts && packageJson.scripts.test) {
            return 'npm test';
          }
        } catch (err) {
          console.error('Error reading package.json:', err);
        }
        return null;
      
      case 'pytest':
        return 'python -m pytest -v';
      
      case 'unittest':
        return 'python -m unittest discover';
      
      case 'python':
        // Check if pytest is available
        try {
          await execAsync('pip list | grep pytest', { cwd: repoPath });
          return 'python -m pytest -v';
        } catch (err) {
          // Fallback to unittest
          return 'python -m unittest discover';
        }
      
      case 'maven':
        return 'mvn test';
      
      case 'gradle':
        return './gradlew test';
      
      case 'rust':
        return 'cargo test';
      
      case 'go':
        return 'go test ./...';
      
      default:
        return null;
    }
  }

  /**
   * Parse test results into a standardized format
   * 
   * @param {string} stdout - Standard output from test command
   * @param {string} stderr - Standard error from test command
   * @param {string} projectType - Type of project
   * @returns {Object} - Standardized test results
   * @private
   */
  _parseTestResults(stdout, stderr, projectType) {
    // Initialize standardized result structure
    const standardResult = {
      success: false,
      summary: {
        total: 0,
        passed: 0,
        failed: 0,
        skipped: 0,
        duration: 0
      },
      details: [],
      rawOutput: stdout,
      rawError: stderr,
      timestamp: new Date().toISOString()
    };
    
    // Handle empty repository case
    if (projectType === 'empty') {
      standardResult.success = true;
      standardResult.summary.skipped = 1;
      standardResult.summary.total = 1;
      standardResult.details.push({
        name: 'repository-empty-check',
        suite: 'system',
        status: 'skipped',
        duration: 0,
        failureMessages: ['Repository is empty, no tests to run']
      });
      return standardResult;
    }
    
    try {
      // Parse based on project type
      switch (projectType) {
        case 'jest':
          return this._parseJestResults(stdout, standardResult);
        
        case 'mocha':
          return this._parseMochaResults(stdout, standardResult);
        
        case 'pytest':
        case 'python':
          return this._parsePythonResults(stdout, stderr, standardResult);
        
        case 'maven':
        case 'gradle':
          return this._parseJavaResults(stdout, stderr, standardResult);
        
        case 'rust':
          return this._parseRustResults(stdout, stderr, standardResult);
        
        case 'go':
          return this._parseGoResults(stdout, stderr, standardResult);
        
        default:
          // Generic parsing for unknown formats
          return this._parseGenericResults(stdout, stderr, standardResult);
      }
    } catch (error) {
      console.error('Error parsing test results:', error);
      standardResult.error = error.message;
      return standardResult;
    }
  }

  /**
   * Parse Jest test results
   * 
   * @param {string} stdout - Standard output from Jest
   * @param {Object} standardResult - Base result object
   * @returns {Object} - Standardized test results
   * @private
   */
  _parseJestResults(stdout, standardResult) {
    try {
      const jestResults = JSON.parse(stdout);
      
      standardResult.success = jestResults.success;
      standardResult.summary.total = jestResults.numTotalTests;
      standardResult.summary.passed = jestResults.numPassedTests;
      standardResult.summary.failed = jestResults.numFailedTests;
      standardResult.summary.skipped = jestResults.numPendingTests;
      standardResult.summary.duration = jestResults.startTime ? (Date.now() - jestResults.startTime) : 0;
      
      // Extract test details
      jestResults.testResults.forEach(suite => {
        suite.assertionResults.forEach(test => {
          standardResult.details.push({
            name: test.title,
            suite: suite.name,
            status: test.status,
            duration: test.duration || 0,
            failureMessages: test.failureMessages || []
          });
        });
      });
      
      return standardResult;
    } catch (error) {
      console.error('Error parsing Jest results:', error);
      return this._parseGenericResults(stdout, '', standardResult);
    }
  }

  /**
   * Parse Mocha test results
   * 
   * @param {string} stdout - Standard output from Mocha
   * @param {Object} standardResult - Base result object
   * @returns {Object} - Standardized test results
   * @private
   */
  _parseMochaResults(stdout, standardResult) {
    try {
      const mochaResults = JSON.parse(stdout);
      
      standardResult.success = mochaResults.stats.failures === 0;
      standardResult.summary.total = mochaResults.stats.tests;
      standardResult.summary.passed = mochaResults.stats.passes;
      standardResult.summary.failed = mochaResults.stats.failures;
      standardResult.summary.skipped = mochaResults.stats.pending;
      standardResult.summary.duration = mochaResults.stats.duration;
      
      // Extract test details
      this._processMochaTests(mochaResults.passes, 'passed', standardResult.details);
      this._processMochaTests(mochaResults.failures, 'failed', standardResult.details);
      this._processMochaTests(mochaResults.pending, 'skipped', standardResult.details);
      
      return standardResult;
    } catch (error) {
      console.error('Error parsing Mocha results:', error);
      return this._parseGenericResults(stdout, '', standardResult);
    }
  }

  /**
   * Helper to process Mocha test results
   * 
   * @param {Array} tests - Array of test objects
   * @param {string} status - Status to assign to these tests
   * @param {Array} details - Array to add processed tests to
   * @private
   */
  _processMochaTests(tests, status, details) {
    if (!Array.isArray(tests)) return;
    
    tests.forEach(test => {
      details.push({
        name: test.title,
        suite: test.fullTitle.replace(test.title, '').trim(),
        status,
        duration: test.duration || 0,
        failureMessages: test.err ? [test.err.message] : []
      });
    });
  }

  /**
   * Parse Python test results (pytest or unittest)
   * 
   * @param {string} stdout - Standard output from Python tests
   * @param {string} stderr - Standard error from Python tests
   * @param {Object} standardResult - Base result object
   * @returns {Object} - Standardized test results
   * @private
   */
  _parsePythonResults(stdout, stderr, standardResult) {
    // This is a simplified parser for Python test output
    // In a real implementation, you might want to use a more robust parser
    // or configure pytest to output JSON
    
    const output = stdout + '\n' + stderr;
    
    // Extract basic summary information using regex
    const totalMatch = output.match(/collected (\d+) items/);
    const passedMatch = output.match(/(\d+) passed/);
    const failedMatch = output.match(/(\d+) failed/);
    const skippedMatch = output.match(/(\d+) skipped/);
    const durationMatch = output.match(/in ([\d\.]+)s/);
    
    standardResult.summary.total = totalMatch ? parseInt(totalMatch[1]) : 0;
    standardResult.summary.passed = passedMatch ? parseInt(passedMatch[1]) : 0;
    standardResult.summary.failed = failedMatch ? parseInt(failedMatch[1]) : 0;
    standardResult.summary.skipped = skippedMatch ? parseInt(skippedMatch[1]) : 0;
    standardResult.summary.duration = durationMatch ? parseFloat(durationMatch[1]) * 1000 : 0;
    
    standardResult.success = standardResult.summary.failed === 0;
    
    // Extract test details (simplified)
    const testLines = output.split('\n').filter(line => 
      line.includes('PASSED') || 
      line.includes('FAILED') || 
      line.includes('SKIPPED')
    );
    
    testLines.forEach(line => {
      const status = line.includes('PASSED') ? 'passed' : 
                    line.includes('FAILED') ? 'failed' : 'skipped';
      
      // Extract test name (simplified)
      const nameMatch = line.match(/([\w\.]+)::\w+/);
      const name = nameMatch ? nameMatch[0] : line.trim();
      
      standardResult.details.push({
        name,
        suite: name.split('::')[0],
        status,
        duration: 0, // Not easily extractable from standard output
        failureMessages: status === 'failed' ? [line] : []
      });
    });
    
    return standardResult;
  }

  /**
   * Parse Java test results (Maven or Gradle)
   * 
   * @param {string} stdout - Standard output from Java tests
   * @param {string} stderr - Standard error from Java tests
   * @param {Object} standardResult - Base result object
   * @returns {Object} - Standardized test results
   * @private
   */
  _parseJavaResults(stdout, stderr, standardResult) {
    const output = stdout + '\n' + stderr;
    
    // Extract basic summary information using regex
    const testsMatch = output.match(/Tests run: (\d+), Failures: (\d+), Errors: (\d+), Skipped: (\d+)/);
    
    if (testsMatch) {
      standardResult.summary.total = parseInt(testsMatch[1]);
      const failures = parseInt(testsMatch[2]);
      const errors = parseInt(testsMatch[3]);
      standardResult.summary.failed = failures + errors;
      standardResult.summary.passed = standardResult.summary.total - standardResult.summary.failed - parseInt(testsMatch[4]);
      standardResult.summary.skipped = parseInt(testsMatch[4]);
    }
    
    // Extract duration (simplified)
    const timeMatch = output.match(/Time elapsed: ([\d\.]+)/);
    if (timeMatch) {
      standardResult.summary.duration = parseFloat(timeMatch[1]) * 1000;
    }
    
    standardResult.success = standardResult.summary.failed === 0;
    
    // Detailed test parsing would require a more sophisticated parser
    // This is a simplified version
    
    return standardResult;
  }

  /**
   * Parse Rust test results
   * 
   * @param {string} stdout - Standard output from Rust tests
   * @param {string} stderr - Standard error from Rust tests
   * @param {Object} standardResult - Base result object
   * @returns {Object} - Standardized test results
   * @private
   */
  _parseRustResults(stdout, stderr, standardResult) {
    const output = stdout + '\n' + stderr;
    
    // Extract basic summary information using regex
    const summaryMatch = output.match(/test result: (\w+). (\d+) passed; (\d+) failed; (\d+) ignored/);
    
    if (summaryMatch) {
      standardResult.success = summaryMatch[1] === 'ok';
      standardResult.summary.passed = parseInt(summaryMatch[2]);
      standardResult.summary.failed = parseInt(summaryMatch[3]);
      standardResult.summary.skipped = parseInt(summaryMatch[4]);
      standardResult.summary.total = standardResult.summary.passed + standardResult.summary.failed + standardResult.summary.skipped;
    }
    
    // Extract duration
    const timeMatch = output.match(/finished in ([\d\.]+)s/);
    if (timeMatch) {
      standardResult.summary.duration = parseFloat(timeMatch[1]) * 1000;
    }
    
    // Extract test details
    const testLines = output.split('\n').filter(line => 
      line.includes('test ') && (
        line.includes(' ... ok') || 
        line.includes(' ... FAILED') || 
        line.includes(' ... ignored')
      )
    );
    
    testLines.forEach(line => {
      const status = line.includes(' ... ok') ? 'passed' : 
                    line.includes(' ... FAILED') ? 'failed' : 'skipped';
      
      // Extract test name
      const nameMatch = line.match(/test ([\w:]+)/);
      const name = nameMatch ? nameMatch[1] : line.trim();
      
      standardResult.details.push({
        name,
        suite: name.split('::')[0],
        status,
        duration: 0, // Not easily extractable from standard output
        failureMessages: status === 'failed' ? [line] : []
      });
    });
    
    return standardResult;
  }

  /**
   * Parse Go test results
   * 
   * @param {string} stdout - Standard output from Go tests
   * @param {string} stderr - Standard error from Go tests
   * @param {Object} standardResult - Base result object
   * @returns {Object} - Standardized test results
   * @private
   */
  _parseGoResults(stdout, stderr, standardResult) {
    const output = stdout + '\n' + stderr;
    
    // Extract basic summary information
    const passedMatch = output.match(/PASS/);
    const failedMatch = output.match(/FAIL/);
    
    standardResult.success = passedMatch && !failedMatch;
    
    // Count tests
    const testLines = output.split('\n').filter(line => 
      line.match(/--- (PASS|FAIL|SKIP): Test\w+/)
    );
    
    standardResult.summary.total = testLines.length;
    standardResult.summary.passed = testLines.filter(line => line.includes('--- PASS')).length;
    standardResult.summary.failed = testLines.filter(line => line.includes('--- FAIL')).length;
    standardResult.summary.skipped = testLines.filter(line => line.includes('--- SKIP')).length;
    
    // Extract duration
    const timeMatch = output.match(/ok\s+[\w\/\.]+\s+([\d\.]+)s/);
    if (timeMatch) {
      standardResult.summary.duration = parseFloat(timeMatch[1]) * 1000;
    }
    
    // Extract test details
    testLines.forEach(line => {
      const status = line.includes('--- PASS') ? 'passed' : 
                    line.includes('--- FAIL') ? 'failed' : 'skipped';
      
      // Extract test name
      const nameMatch = line.match(/--- (PASS|FAIL|SKIP): (\w+)/);
      const name = nameMatch ? nameMatch[2] : line.trim();
      
      standardResult.details.push({
        name,
        suite: 'go_tests', // Go doesn't have a clear suite concept in output
        status,
        duration: 0, // Not easily extractable from standard output
        failureMessages: status === 'failed' ? [line] : []
      });
    });
    
    return standardResult;
  }

  /**
   * Generic parser for unknown test formats
   * 
   * @param {string} stdout - Standard output from tests
   * @param {string} stderr - Standard error from tests
   * @param {Object} standardResult - Base result object
   * @returns {Object} - Standardized test results
   * @private
   */
  _parseGenericResults(stdout, stderr, standardResult) {
    const output = stdout + '\n' + stderr;
    
    // Try to determine success/failure based on common patterns
    standardResult.success = !(
      output.includes('FAIL') || 
      output.includes('ERROR') || 
      output.includes('FAILURE') || 
      output.includes('Exception') ||
      stderr.length > 0
    );
    
    // Try to extract some basic counts
    const lines = output.split('\n');
    let testCount = 0;
    
    // Count lines that look like test results
    lines.forEach(line => {
      if (line.match(/test|spec|should|it /i) && 
          (line.includes('pass') || line.includes('fail') || line.includes('error'))) {
        testCount++;
        
        const status = line.includes('pass') ? 'passed' : 'failed';
        
        standardResult.details.push({
          name: line.trim(),
          suite: 'unknown',
          status,
          duration: 0,
          failureMessages: status === 'failed' ? [line] : []
        });
      }
    });
    
    standardResult.summary.total = testCount || 1; // Assume at least one test was run
    
    if (standardResult.success) {
      standardResult.summary.passed = standardResult.summary.total;
    } else {
      // If we couldn't determine the exact count, assume 1 failure
      standardResult.summary.failed = 1;
      standardResult.summary.passed = standardResult.summary.total - 1;
    }
    
    return standardResult;
  }

  /**
   * Notify the Coral Protocol about agent actions
   * 
   * @param {Object} data - Data to send to Coral Protocol
   * @returns {Promise<void>}
   * @private
   */
  async _notifyCoralProtocol(data) {
    try {
      // This is a placeholder for actual implementation
      // In a real implementation, this would use fetch or axios to send data to the Coral Protocol
      console.log('Notifying Coral Protocol:', data);
      
      // Example implementation with fetch (would require node-fetch package)
      // const fetch = require('node-fetch');
      // await fetch(this.coralProtocolEndpoint, {
      //   method: 'POST',
      //   headers: { 'Content-Type': 'application/json' },
      //   body: JSON.stringify(data)
      // });
    } catch (error) {
      console.error('Failed to notify Coral Protocol:', error);
    }
  }
}

module.exports = UnitTestAgent;

// Example usage:
// const tester = new UnitTestAgent();
// tester.runTests({
//   repoPath: '/path/to/cloned/repo',
//   repoId: 'my-test-repo'
// }).then(results => {
//   console.log('Test results:', results.summary);
// }).catch(err => {
//   console.error('Testing failed:', err);
// });