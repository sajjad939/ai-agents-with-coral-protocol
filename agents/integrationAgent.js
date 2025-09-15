/**
 * integrationAgent.js
 * 
 * This agent is responsible for running integration tests, simulating multi-module
 * interactions. It captures logs, detects errors, and returns structured outputs.
 * It handles both backend and frontend integration test workflows where applicable.
 */

const { exec, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const util = require('util');

// Promisify exec for async/await usage
const execAsync = util.promisify(exec);

class IntegrationAgent {
  constructor(config = {}) {
    this.timeout = config.timeout || 1200000; // 20 minutes default timeout for integration tests
    this.coralProtocolEndpoint = config.coralProtocolEndpoint || 'http://localhost:3000/api/coral';
    this.logDir = config.logDir || path.join(process.cwd(), 'logs');
    
    // Ensure log directory exists
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }

  /**
   * Run integration tests for a repository
   * 
   * @param {Object} params - Test parameters
   * @param {string} params.repoPath - Path to the repository
   * @param {string} params.repoId - Unique identifier for this repository
   * @param {string} params.testCommand - Optional specific test command to run
   * @param {Object} params.env - Optional environment variables for the test
   * @param {boolean} params.captureScreenshots - Whether to capture screenshots during UI tests
   * @returns {Promise<Object>} - Test results in standardized format
   */
  async runTests(params) {
    const { repoPath, repoId, testCommand, env = {}, captureScreenshots = false } = params;
    
    if (!repoPath || !fs.existsSync(repoPath)) {
      throw new Error(`Repository path does not exist: ${repoPath}`);
    }

    // Create a unique log file for this test run
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const logFile = path.join(this.logDir, `integration-${repoId}-${timestamp}.log`);
    const logStream = fs.createWriteStream(logFile, { flags: 'a' });
    
    try {
      // Notify Coral Protocol that testing has started
      await this._notifyCoralProtocol({
        status: 'started',
        repoId,
        action: 'integration_test',
        timestamp: new Date().toISOString(),
        logFile
      });

      // Detect project type and determine integration test command
      const projectType = await this._detectProjectType(repoPath);
      
      // Check if repository is empty
      if (projectType === 'empty') {
        console.log('Repository is empty, skipping integration tests');
        const results = {
          success: true,
          summary: {
            total: 1,
            passed: 0,
            failed: 0,
            skipped: 1,
            duration: 0
          },
          details: [{
            name: 'repository-empty-check',
            suite: 'system',
            status: 'skipped',
            duration: 0,
            failureMessages: ['Repository is empty, no integration tests to run']
          }],
          rawOutput: 'Repository is empty, no integration tests to run',
          rawError: '',
          timestamp: new Date().toISOString(),
          logFile
        };
        
        // Notify Coral Protocol about test completion
        await this._notifyCoralProtocol({
          status: 'completed',
          repoId,
          action: 'integration_test',
          results: results.summary,
          logFile,
          timestamp: new Date().toISOString()
        });
        
        // Close log stream
        logStream.end();
        
        return results;
      }
      
      const command = testCommand || await this._determineIntegrationTestCommand(repoPath, projectType);
      
      if (!command) {
        throw new Error(`Could not determine integration test command for project type: ${projectType}`);
      }

      // Log the command we're about to run
      logStream.write(`Running integration test command: ${command}\n`);
      console.log(`Running integration test command: ${command}`);
      
      // Prepare environment variables
      const testEnv = {
        ...process.env,
        NODE_ENV: 'test',
        ...env
      };
      
      // For UI tests with screenshots, set up the screenshot directory
      if (captureScreenshots) {
        const screenshotDir = path.join(this.logDir, `screenshots-${repoId}-${timestamp}`);
        fs.mkdirSync(screenshotDir, { recursive: true });
        testEnv.SCREENSHOT_DIR = screenshotDir;
      }
      
      // Execute test command and capture output
      const startTime = Date.now();
      const { stdout, stderr } = await this._executeCommand(command, {
        cwd: repoPath,
        env: testEnv,
        timeout: this.timeout,
        logStream
      });
      const duration = Date.now() - startTime;

      // Parse test results into standardized format
      const results = this._parseIntegrationTestResults(stdout, stderr, projectType, duration);
      results.logFile = logFile;
      
      // If screenshots were captured, add them to the results
      if (captureScreenshots && testEnv.SCREENSHOT_DIR && fs.existsSync(testEnv.SCREENSHOT_DIR)) {
        results.screenshots = fs.readdirSync(testEnv.SCREENSHOT_DIR)
          .map(file => path.join(testEnv.SCREENSHOT_DIR, file));
      }
      
      // Notify Coral Protocol about test completion
      await this._notifyCoralProtocol({
        status: 'completed',
        repoId,
        action: 'integration_test',
        results: results.summary,
        logFile,
        timestamp: new Date().toISOString()
      });

      // Close log stream
      logStream.end();
      
      return results;
    } catch (error) {
      // Log the error
      logStream.write(`Error running integration tests: ${error.message}\n`);
      if (error.stack) {
        logStream.write(`${error.stack}\n`);
      }
      
      // Notify Coral Protocol about test failure
      await this._notifyCoralProtocol({
        status: 'error',
        repoId,
        action: 'integration_test',
        error: error.message,
        logFile,
        timestamp: new Date().toISOString()
      });
      
      // Close log stream
      logStream.end();
      
      throw new Error(`Failed to run integration tests: ${error.message}`);
    }
  }

  /**
   * Execute a command and stream output to a log file
   * 
   * @param {string} command - Command to execute
   * @param {Object} options - Command options
   * @returns {Promise<Object>} - Command output
   * @private
   */
  async _executeCommand(command, options) {
    return new Promise((resolve, reject) => {
      const { logStream } = options;
      let stdout = '';
      let stderr = '';
      
      // Split command into executable and args
      const parts = command.split(' ');
      const cmd = parts[0];
      const args = parts.slice(1);
      
      // Spawn the process
      const proc = spawn(cmd, args, {
        cwd: options.cwd,
        env: options.env,
        shell: true
      });
      
      // Set up timeout if specified
      let timeoutId;
      if (options.timeout) {
        timeoutId = setTimeout(() => {
          proc.kill();
          reject(new Error(`Command timed out after ${options.timeout}ms: ${command}`));
        }, options.timeout);
      }
      
      // Capture stdout
      proc.stdout.on('data', (data) => {
        const str = data.toString();
        stdout += str;
        if (logStream) {
          logStream.write(str);
        }
      });
      
      // Capture stderr
      proc.stderr.on('data', (data) => {
        const str = data.toString();
        stderr += str;
        if (logStream) {
          logStream.write(`[ERROR] ${str}`);
        }
      });
      
      // Handle process completion
      proc.on('close', (code) => {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
        
        if (logStream) {
          logStream.write(`\nProcess exited with code ${code}\n`);
        }
        
        if (code !== 0) {
          reject(new Error(`Command failed with exit code ${code}: ${command}`));
        } else {
          resolve({ stdout, stderr });
        }
      });
      
      // Handle process errors
      proc.on('error', (err) => {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
        
        if (logStream) {
          logStream.write(`\nProcess error: ${err.message}\n`);
        }
        
        reject(err);
      });
    });
  }

  /**
   * Detect the type of project in the repository
   * 
   * @param {string} repoPath - Path to the repository
   * @returns {Promise<string>} - Detected project type
   * @private
   */
  async _detectProjectType(repoPath) {
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
    // Check for package.json (Node.js)
    if (fs.existsSync(path.join(repoPath, 'package.json'))) {
      const packageJson = JSON.parse(fs.readFileSync(path.join(repoPath, 'package.json'), 'utf8'));
      
      // Check for specific frameworks in dependencies
      const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };
      
      if (deps.cypress) return 'cypress';
      if (deps['@playwright/test']) return 'playwright';
      if (deps.protractor) return 'protractor';
      if (deps.jest && (deps['@testing-library/react'] || deps['@testing-library/vue'])) return 'jest-dom';
      if (deps.jest) return 'jest';
      if (deps.mocha && deps.supertest) return 'mocha-supertest';
      
      return 'node';
    }
    
    // Check for requirements.txt or setup.py (Python)
    if (fs.existsSync(path.join(repoPath, 'requirements.txt')) || 
        fs.existsSync(path.join(repoPath, 'setup.py'))) {
      // Check for specific test frameworks
      try {
        const files = await fs.promises.readdir(repoPath);
        if (files.some(file => file.includes('selenium'))) return 'selenium-python';
        if (files.some(file => file.includes('pytest'))) return 'pytest';
        if (files.some(file => file.includes('behave'))) return 'behave';
      } catch (err) {
        console.error('Error reading directory:', err);
      }
      
      return 'python';
    }
    
    // Check for pom.xml (Java/Maven)
    if (fs.existsSync(path.join(repoPath, 'pom.xml'))) {
      // Check for specific test frameworks in pom.xml
      const pomXml = fs.readFileSync(path.join(repoPath, 'pom.xml'), 'utf8');
      if (pomXml.includes('selenium')) return 'selenium-java';
      if (pomXml.includes('cucumber')) return 'cucumber-java';
      if (pomXml.includes('rest-assured')) return 'rest-assured';
      
      return 'maven';
    }
    
    // Check for build.gradle (Java/Gradle)
    if (fs.existsSync(path.join(repoPath, 'build.gradle'))) {
      return 'gradle';
    }
    
    // Check for docker-compose.yml (Docker)
    if (fs.existsSync(path.join(repoPath, 'docker-compose.yml'))) {
      return 'docker-compose';
    }
    
    // Default to unknown
    return 'unknown';
  }

  /**
   * Determine the appropriate integration test command based on project type
   * 
   * @param {string} repoPath - Path to the repository
   * @param {string} projectType - Type of project detected
   * @returns {Promise<string>} - Test command to execute
   * @private
   */
  async _determineIntegrationTestCommand(repoPath, projectType) {
    switch (projectType) {
      case 'cypress':
        return 'npx cypress run';
      
      case 'playwright':
        return 'npx playwright test';
      
      case 'protractor':
        return 'npx protractor e2e/protractor.conf.js';
      
      case 'jest-dom':
        return 'npx jest --testPathPattern=integration';
      
      case 'jest':
        // Look for integration test directory
        if (fs.existsSync(path.join(repoPath, 'tests/integration'))) {
          return 'npx jest tests/integration';
        } else if (fs.existsSync(path.join(repoPath, '__tests__/integration'))) {
          return 'npx jest __tests__/integration';
        } else if (fs.existsSync(path.join(repoPath, 'integration'))) {
          return 'npx jest integration';
        }
        return 'npx jest --testPathPattern=integration';
      
      case 'mocha-supertest':
        // Look for integration test directory
        if (fs.existsSync(path.join(repoPath, 'test/integration'))) {
          return 'npx mocha test/integration';
        } else if (fs.existsSync(path.join(repoPath, 'tests/integration'))) {
          return 'npx mocha tests/integration';
        }
        return 'npx mocha "**/*.integration.js"';
      
      case 'node':
        // Check if there's an integration test script in package.json
        try {
          const packageJson = JSON.parse(fs.readFileSync(path.join(repoPath, 'package.json'), 'utf8'));
          if (packageJson.scripts) {
            if (packageJson.scripts['test:integration']) {
              return 'npm run test:integration';
            } else if (packageJson.scripts['integration']) {
              return 'npm run integration';
            } else if (packageJson.scripts['e2e']) {
              return 'npm run e2e';
            }
          }
        } catch (err) {
          console.error('Error reading package.json:', err);
        }
        return null;
      
      case 'selenium-python':
        return 'python -m pytest tests/integration';
      
      case 'pytest':
        // Look for integration test directory
        if (fs.existsSync(path.join(repoPath, 'tests/integration'))) {
          return 'python -m pytest tests/integration';
        } else if (fs.existsSync(path.join(repoPath, 'integration'))) {
          return 'python -m pytest integration';
        }
        return 'python -m pytest -k "integration"';
      
      case 'behave':
        return 'behave';
      
      case 'selenium-java':
      case 'cucumber-java':
      case 'rest-assured':
      case 'maven':
        return 'mvn verify';
      
      case 'gradle':
        return './gradlew integrationTest';
      
      case 'docker-compose':
        return 'docker-compose up --abort-on-container-exit --exit-code-from test';
      
      default:
        return null;
    }
  }

  /**
   * Parse integration test results into a standardized format
   * 
   * @param {string} stdout - Standard output from test command
   * @param {string} stderr - Standard error from test command
   * @param {string} projectType - Type of project
   * @param {number} duration - Test duration in milliseconds
   * @returns {Object} - Standardized test results
   * @private
   */
  _parseIntegrationTestResults(stdout, stderr, projectType, duration) {
    // Initialize standardized result structure
    const standardResult = {
      success: false,
      summary: {
        total: 0,
        passed: 0,
        failed: 0,
        skipped: 0,
        duration: duration || 0
      },
      details: [],
      rawOutput: stdout,
      rawError: stderr,
      timestamp: new Date().toISOString()
    };
    
    try {
      // Parse based on project type
      switch (projectType) {
        case 'cypress':
          return this._parseCypressResults(stdout, stderr, standardResult);
        
        case 'playwright':
          return this._parsePlaywrightResults(stdout, stderr, standardResult);
        
        case 'jest-dom':
        case 'jest':
          return this._parseJestResults(stdout, stderr, standardResult);
        
        case 'mocha-supertest':
          return this._parseMochaResults(stdout, stderr, standardResult);
        
        case 'selenium-python':
        case 'pytest':
          return this._parsePytestResults(stdout, stderr, standardResult);
        
        case 'behave':
          return this._parseBehaveResults(stdout, stderr, standardResult);
        
        case 'selenium-java':
        case 'cucumber-java':
        case 'rest-assured':
        case 'maven':
        case 'gradle':
          return this._parseJavaResults(stdout, stderr, standardResult);
        
        case 'docker-compose':
          return this._parseDockerComposeResults(stdout, stderr, standardResult);
        
        default:
          // Generic parsing for unknown formats
          return this._parseGenericResults(stdout, stderr, standardResult);
      }
    } catch (error) {
      console.error('Error parsing integration test results:', error);
      standardResult.error = error.message;
      return standardResult;
    }
  }

  /**
   * Parse Cypress test results
   * 
   * @param {string} stdout - Standard output from Cypress
   * @param {string} stderr - Standard error from Cypress
   * @param {Object} standardResult - Base result object
   * @returns {Object} - Standardized test results
   * @private
   */
  _parseCypressResults(stdout, stderr, standardResult) {
    const output = stdout + '\n' + stderr;
    
    // Check for overall success/failure
    standardResult.success = !output.includes('(Run Finished)');
    
    // Extract test counts
    const totalMatch = output.match(/(\d+) passing|failing|pending/g);
    if (totalMatch) {
      const passingMatch = output.match(/(\d+) passing/);
      const failingMatch = output.match(/(\d+) failing/);
      const pendingMatch = output.match(/(\d+) pending/);
      
      standardResult.summary.passed = passingMatch ? parseInt(passingMatch[1]) : 0;
      standardResult.summary.failed = failingMatch ? parseInt(failingMatch[1]) : 0;
      standardResult.summary.skipped = pendingMatch ? parseInt(pendingMatch[1]) : 0;
      standardResult.summary.total = standardResult.summary.passed + standardResult.summary.failed + standardResult.summary.skipped;
    }
    
    // Extract test details
    const testLines = output.split('\n').filter(line => 
      line.includes('✓') || line.includes('✗') || line.includes('- ')
    );
    
    testLines.forEach(line => {
      const status = line.includes('✓') ? 'passed' : 
                    line.includes('✗') ? 'failed' : 'skipped';
      
      // Extract test name
      const nameMatch = line.match(/[✓✗-]\s+(.+)/);
      const name = nameMatch ? nameMatch[1].trim() : line.trim();
      
      standardResult.details.push({
        name,
        suite: 'cypress',
        status,
        duration: 0, // Not easily extractable from standard output
        failureMessages: status === 'failed' ? [line] : []
      });
    });
    
    return standardResult;
  }

  /**
   * Parse Playwright test results
   * 
   * @param {string} stdout - Standard output from Playwright
   * @param {string} stderr - Standard error from Playwright
   * @param {Object} standardResult - Base result object
   * @returns {Object} - Standardized test results
   * @private
   */
  _parsePlaywrightResults(stdout, stderr, standardResult) {
    const output = stdout + '\n' + stderr;
    
    // Check for overall success/failure
    standardResult.success = output.includes('passed') && !output.includes('failed');
    
    // Extract test counts
    const summaryMatch = output.match(/(\d+) passed(\s+\/(\s+)(\d+) failed)?/);
    if (summaryMatch) {
      standardResult.summary.passed = parseInt(summaryMatch[1]);
      standardResult.summary.failed = summaryMatch[4] ? parseInt(summaryMatch[4]) : 0;
      standardResult.summary.total = standardResult.summary.passed + standardResult.summary.failed;
    }
    
    // Extract test details
    const testLines = output.split('\n').filter(line => 
      line.includes('✓') || line.includes('✗') || line.includes('- ')
    );
    
    testLines.forEach(line => {
      const status = line.includes('✓') ? 'passed' : 
                    line.includes('✗') ? 'failed' : 'skipped';
      
      // Extract test name
      const nameMatch = line.match(/[✓✗-]\s+(.+)/);
      const name = nameMatch ? nameMatch[1].trim() : line.trim();
      
      standardResult.details.push({
        name,
        suite: 'playwright',
        status,
        duration: 0, // Not easily extractable from standard output
        failureMessages: status === 'failed' ? [line] : []
      });
    });
    
    return standardResult;
  }

  /**
   * Parse Jest test results
   * 
   * @param {string} stdout - Standard output from Jest
   * @param {string} stderr - Standard error from Jest
   * @param {Object} standardResult - Base result object
   * @returns {Object} - Standardized test results
   * @private
   */
  _parseJestResults(stdout, stderr, standardResult) {
    const output = stdout + '\n' + stderr;
    
    // Check for overall success/failure
    standardResult.success = output.includes('PASS') && !output.includes('FAIL');
    
    // Extract test counts
    const summaryMatch = output.match(/Tests:\s+(\d+) passed,\s+(\d+) failed,\s+(\d+) total/);
    if (summaryMatch) {
      standardResult.summary.passed = parseInt(summaryMatch[1]);
      standardResult.summary.failed = parseInt(summaryMatch[2]);
      standardResult.summary.total = parseInt(summaryMatch[3]);
    }
    
    // Extract skipped tests
    const skippedMatch = output.match(/(\d+) skipped/);
    if (skippedMatch) {
      standardResult.summary.skipped = parseInt(skippedMatch[1]);
    }
    
    // Extract test details
    const testLines = output.split('\n').filter(line => 
      line.includes('✓') || line.includes('✕') || line.includes('○')
    );
    
    testLines.forEach(line => {
      const status = line.includes('✓') ? 'passed' : 
                    line.includes('✕') ? 'failed' : 'skipped';
      
      // Extract test name
      const nameMatch = line.match(/[✓✕○]\s+(.+)/);
      const name = nameMatch ? nameMatch[1].trim() : line.trim();
      
      standardResult.details.push({
        name,
        suite: 'jest',
        status,
        duration: 0, // Not easily extractable from standard output
        failureMessages: status === 'failed' ? [line] : []
      });
    });
    
    return standardResult;
  }

  /**
   * Parse Mocha test results
   * 
   * @param {string} stdout - Standard output from Mocha
   * @param {string} stderr - Standard error from Mocha
   * @param {Object} standardResult - Base result object
   * @returns {Object} - Standardized test results
   * @private
   */
  _parseMochaResults(stdout, stderr, standardResult) {
    const output = stdout + '\n' + stderr;
    
    // Check for overall success/failure
    standardResult.success = !output.includes('failing');
    
    // Extract test counts
    const passedMatch = output.match(/(\d+) passing/);
    const failedMatch = output.match(/(\d+) failing/);
    const pendingMatch = output.match(/(\d+) pending/);
    
    standardResult.summary.passed = passedMatch ? parseInt(passedMatch[1]) : 0;
    standardResult.summary.failed = failedMatch ? parseInt(failedMatch[1]) : 0;
    standardResult.summary.skipped = pendingMatch ? parseInt(pendingMatch[1]) : 0;
    standardResult.summary.total = standardResult.summary.passed + standardResult.summary.failed + standardResult.summary.skipped;
    
    // Extract test details
    const testLines = output.split('\n').filter(line => 
      line.match(/\s+✓|\s+✖|\s+-/)
    );
    
    testLines.forEach(line => {
      const status = line.includes('✓') ? 'passed' : 
                    line.includes('✖') ? 'failed' : 'skipped';
      
      // Extract test name
      const nameMatch = line.match(/[✓✖-]\s+(.+)/);
      const name = nameMatch ? nameMatch[1].trim() : line.trim();
      
      standardResult.details.push({
        name,
        suite: 'mocha',
        status,
        duration: 0, // Not easily extractable from standard output
        failureMessages: status === 'failed' ? [line] : []
      });
    });
    
    return standardResult;
  }

  /**
   * Parse Pytest test results
   * 
   * @param {string} stdout - Standard output from Pytest
   * @param {string} stderr - Standard error from Pytest
   * @param {Object} standardResult - Base result object
   * @returns {Object} - Standardized test results
   * @private
   */
  _parsePytestResults(stdout, stderr, standardResult) {
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
    
    if (durationMatch) {
      standardResult.summary.duration = parseFloat(durationMatch[1]) * 1000;
    }
    
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
   * Parse Behave test results
   * 
   * @param {string} stdout - Standard output from Behave
   * @param {string} stderr - Standard error from Behave
   * @param {Object} standardResult - Base result object
   * @returns {Object} - Standardized test results
   * @private
   */
  _parseBehaveResults(stdout, stderr, standardResult) {
    const output = stdout + '\n' + stderr;
    
    // Extract basic summary information
    const featuresMatch = output.match(/(\d+) features passed, (\d+) failed, (\d+) skipped/);
    const scenariosMatch = output.match(/(\d+) scenarios passed, (\d+) failed, (\d+) skipped/);
    const stepsMatch = output.match(/(\d+) steps passed, (\d+) failed, (\d+) skipped/);
    
    if (scenariosMatch) {
      standardResult.summary.passed = parseInt(scenariosMatch[1]);
      standardResult.summary.failed = parseInt(scenariosMatch[2]);
      standardResult.summary.skipped = parseInt(scenariosMatch[3]);
      standardResult.summary.total = standardResult.summary.passed + standardResult.summary.failed + standardResult.summary.skipped;
    } else if (stepsMatch) {
      standardResult.summary.passed = parseInt(stepsMatch[1]);
      standardResult.summary.failed = parseInt(stepsMatch[2]);
      standardResult.summary.skipped = parseInt(stepsMatch[3]);
      standardResult.summary.total = standardResult.summary.passed + standardResult.summary.failed + standardResult.summary.skipped;
    }
    
    standardResult.success = standardResult.summary.failed === 0;
    
    // Extract feature and scenario details
    const featureLines = output.split('\n').filter(line => line.startsWith('Feature:'));
    const scenarioLines = output.split('\n').filter(line => line.startsWith('  Scenario:'));
    
    featureLines.forEach(line => {
      const name = line.replace('Feature:', '').trim();
      standardResult.details.push({
        name,
        suite: 'features',
        status: 'info', // Features don't have a direct pass/fail status
        duration: 0,
        failureMessages: []
      });
    });
    
    scenarioLines.forEach(line => {
      const name = line.replace('Scenario:', '').trim();
      const status = output.includes(`Scenario: ${name}\n    ✗`) ? 'failed' : 'passed';
      
      standardResult.details.push({
        name,
        suite: 'scenarios',
        status,
        duration: 0,
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
      standardResult.summary.skipped = parseInt(testsMatch[4]);
      standardResult.summary.passed = standardResult.summary.total - standardResult.summary.failed - standardResult.summary.skipped;
    }
    
    // Extract duration (simplified)
    const timeMatch = output.match(/Time elapsed: ([\d\.]+)/);
    if (timeMatch) {
      standardResult.summary.duration = parseFloat(timeMatch[1]) * 1000;
    }
    
    standardResult.success = standardResult.summary.failed === 0;
    
    // Extract test details (simplified)
    const testLines = output.split('\n').filter(line => 
      line.includes('Test ') && (
        line.includes(' PASSED') || 
        line.includes(' FAILED') || 
        line.includes(' SKIPPED')
      )
    );
    
    testLines.forEach(line => {
      const status = line.includes(' PASSED') ? 'passed' : 
                    line.includes(' FAILED') ? 'failed' : 'skipped';
      
      // Extract test name
      const nameMatch = line.match(/Test ([\w\.]+)/);
      const name = nameMatch ? nameMatch[1] : line.trim();
      
      standardResult.details.push({
        name,
        suite: name.split('.')[0],
        status,
        duration: 0, // Not easily extractable from standard output
        failureMessages: status === 'failed' ? [line] : []
      });
    });
    
    return standardResult;
  }

  /**
   * Parse Docker Compose test results
   * 
   * @param {string} stdout - Standard output from Docker Compose
   * @param {string} stderr - Standard error from Docker Compose
   * @param {Object} standardResult - Base result object
   * @returns {Object} - Standardized test results
   * @private
   */
  _parseDockerComposeResults(stdout, stderr, standardResult) {
    const output = stdout + '\n' + stderr;
    
    // For Docker Compose, we mainly care about the exit code
    // which is handled by the _executeCommand method
    standardResult.success = !output.includes('exited with code') || output.includes('exited with code 0');
    
    // Try to extract container-specific test results
    // This is highly dependent on what test framework is running inside the containers
    
    // Generic approach: count lines that look like test results
    const testLines = output.split('\n').filter(line => 
      (line.includes('PASS') || line.includes('FAIL') || line.includes('ERROR')) &&
      !line.includes('docker') && !line.includes('compose')
    );
    
    standardResult.summary.total = testLines.length || 1;
    standardResult.summary.passed = testLines.filter(line => 
      line.includes('PASS') && !line.includes('FAIL')
    ).length;
    
    standardResult.summary.failed = testLines.filter(line => 
      line.includes('FAIL') || line.includes('ERROR')
    ).length;
    
    if (standardResult.summary.passed === 0 && standardResult.summary.failed === 0) {
      // If we couldn't determine specific test counts, use the overall success/failure
      standardResult.summary.total = 1;
      standardResult.summary.passed = standardResult.success ? 1 : 0;
      standardResult.summary.failed = standardResult.success ? 0 : 1;
    }
    
    // Add container logs as test details
    const containerLogs = output.split('\n').filter(line => 
      line.match(/^\w+\s+\|/)
    );
    
    const containers = new Set();
    containerLogs.forEach(line => {
      const containerMatch = line.match(/^(\w+)\s+\|/);
      if (containerMatch) {
        containers.add(containerMatch[1]);
      }
    });
    
    containers.forEach(container => {
      standardResult.details.push({
        name: `Container: ${container}`,
        suite: 'docker-compose',
        status: standardResult.success ? 'passed' : 'failed',
        duration: 0,
        failureMessages: standardResult.success ? [] : [`Container ${container} failed`]
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
      if (line.match(/test|spec|should|it |scenario/i) && 
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

module.exports = IntegrationAgent;

// Example usage:
// const integrationTester = new IntegrationAgent();
// integrationTester.runTests({
//   repoPath: '/path/to/cloned/repo',
//   repoId: 'my-test-repo',
//   captureScreenshots: true,
//   env: { API_URL: 'http://localhost:3000/api' }
// }).then(results => {
//   console.log('Integration test results:', results.summary);
// }).catch(err => {
//   console.error('Integration testing failed:', err);
// });