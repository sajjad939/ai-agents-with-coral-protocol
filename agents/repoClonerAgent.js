/**
 * repoClonerAgent.js
 * 
 * This agent is responsible for securely cloning a target GitHub/GitLab repository
 * into a controlled environment for testing. It supports both public and private
 * repositories with token-based authentication and integrates with the Coral Protocol
 * for orchestrated agent communication.
 */

const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const util = require('util');

// Promisify exec for async/await usage
const execAsync = util.promisify(exec);

class RepoClonerAgent {
  constructor(config = {}) {
    this.workDir = config.workDir || path.join(process.cwd(), 'repos');
    this.timeout = config.timeout || 300000; // 5 minutes default timeout
    this.coralProtocolEndpoint = config.coralProtocolEndpoint || 'http://localhost:3000/api/coral';
    
    // Ensure work directory exists
    if (!fs.existsSync(this.workDir)) {
      fs.mkdirSync(this.workDir, { recursive: true });
    }
  }

  /**
   * Clone a repository from GitHub or GitLab
   * 
   * @param {Object} params - Repository parameters
   * @param {string} params.repoUrl - URL of the repository to clone
   * @param {string} params.branch - Branch to checkout (optional)
   * @param {string} params.accessToken - Access token for private repositories (optional)
   * @param {string} params.repoId - Unique identifier for this repository
   * @returns {Promise<Object>} - Result of the cloning operation
   */
  async cloneRepository(params) {
    const { repoUrl, branch, accessToken, repoId } = params;
    
    if (!repoUrl) {
      throw new Error('Repository URL is required');
    }

    // Generate a unique folder name based on repoId or URL
    const repoFolder = repoId || this._generateRepoFolderId(repoUrl);
    const repoPath = path.join(this.workDir, repoFolder);
    
    // Clean up existing directory if it exists
    if (fs.existsSync(repoPath)) {
      await this._removeDirectory(repoPath);
    }
    
    try {
      // Prepare git clone command with authentication if needed
      let cloneUrl = repoUrl;
      
      // Handle authentication for private repositories
      if (accessToken) {
        // Format: https://{token}@github.com/user/repo.git
        const urlObj = new URL(repoUrl);
        cloneUrl = `https://${accessToken}@${urlObj.host}${urlObj.pathname}`;
      }
      
      // Clone the repository
      const cloneCmd = `git clone ${cloneUrl} "${repoPath}"`;
      await execAsync(cloneCmd, { timeout: this.timeout });
      
      // Checkout specific branch if specified
      if (branch) {
        try {
          // First check if the branch exists
          const branchCheckCmd = `cd "${repoPath}"; git branch -a`;
          const { stdout } = await execAsync(branchCheckCmd, { timeout: this.timeout, shell: 'powershell.exe' });
          
          // Only checkout if branch exists
          if (stdout.includes(`remotes/origin/${branch}`) || stdout.includes(branch)) {
            // Use PowerShell compatible command for Windows with proper command separator
            const checkoutCmd = `cd "${repoPath}"; git checkout ${branch}`;
            await execAsync(checkoutCmd, { timeout: this.timeout, shell: 'powershell.exe' });
          } else {
            console.warn(`Branch '${branch}' not found. Using default branch.`);
          }
        } catch (branchError) {
          console.warn(`Unable to checkout branch '${branch}': ${branchError.message}. Using default branch.`);
        }
      }
      
      // Notify Coral Protocol about successful clone
      await this._notifyCoralProtocol({
        status: 'success',
        repoId: repoFolder,
        path: repoPath,
        action: 'clone',
        timestamp: new Date().toISOString()
      });
      
      return {
        success: true,
        repoId: repoFolder,
        path: repoPath,
        branch: branch || 'default'
      };
    } catch (error) {
      // Notify Coral Protocol about failure
      await this._notifyCoralProtocol({
        status: 'error',
        repoId: repoFolder,
        action: 'clone',
        error: error.message,
        timestamp: new Date().toISOString()
      });
      
      throw new Error(`Failed to clone repository: ${error.message}`);
    }
  }
  
  /**
   * Generate a unique folder ID based on repository URL
   * 
   * @param {string} repoUrl - Repository URL
   * @returns {string} - Unique folder ID
   * @private
   */
  _generateRepoFolderId(repoUrl) {
    // Extract repo name from URL and add timestamp
    const urlParts = repoUrl.split('/');
    const repoName = urlParts[urlParts.length - 1].replace('.git', '');
    return `${repoName}-${Date.now()}`;
  }
  
  /**
   * Remove a directory recursively
   * 
   * @param {string} dirPath - Path to directory
   * @returns {Promise<void>}
   * @private
   */
  async _removeDirectory(dirPath) {
    return new Promise((resolve, reject) => {
      fs.rm(dirPath, { recursive: true, force: true }, (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
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

module.exports = RepoClonerAgent;

// Example usage:
// const cloner = new RepoClonerAgent();
// cloner.cloneRepository({
//   repoUrl: 'https://github.com/username/repo.git',
//   branch: 'main',
//   accessToken: 'github_pat_xxx', // For private repos
//   repoId: 'my-test-repo'
// }).then(result => {
//   console.log('Repository cloned:', result);
// }).catch(err => {
//   console.error('Clone failed:', err);
// });