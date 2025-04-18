import { spawnSync } from 'child_process';
import { sleep } from 'bun';
import { writeFileSync, existsSync, unlinkSync } from 'fs';
import { join } from 'path';
import postgres from 'postgres';

// Use a sentinel file to track if Docker container is running
const DOCKER_SENTINEL = join(process.cwd(), '.docker-container-running');

// Type definition for test resources to be cleaned up
export type TestResources = {
  sql?: postgres.Sql<{}>;
  useDockerDb: boolean;
  originalDbAlias?: string;
  isCleanedUp: boolean;
  dbConfig?: any;
};

// Global test resources registry - allows cleanup from any context
const globalTestResources: TestResources[] = [];

const isDockerRunning = (): boolean => {
  process.stdout.write('Checking if Docker is running... ');
  const result = spawnSync('docker', ['info'], { stdio: 'pipe' });
  const isRunning = result.status === 0;
  console.log(isRunning ? 'yes' : 'no');
  return isRunning;
};

// Helper to check if the docker image is already pulled
const isImagePulled = (imageName: string): boolean => {
  process.stdout.write(`Checking if ${imageName} image exists... `);
  const result = spawnSync('docker', ['images', '-q', imageName], { stdio: 'pipe' });
  const isPulled = result.status === 0 && result.stdout.toString().trim() !== '';
  console.log(isPulled ? 'yes' : 'no');
  return isPulled;
};

// Helper to get container logs for debugging
const getContainerLogs = (containerName: string): string => {
  console.log(`Getting logs for container ${containerName}...`);
  const result = spawnSync('docker', ['logs', containerName], { stdio: 'pipe' });
  return result.stdout.toString();
};

// Make the setup even faster by using a custom command to start Docker
const startFastDockerDb = async (): Promise<boolean> => {
  console.log('Fast-starting PostgreSQL container...');
  
  // Pull the image first if needed
  if (!isImagePulled('postgres:14')) {
    console.log('Pulling PostgreSQL image...');
    const pullResult = spawnSync('docker', ['pull', 'postgres:14'], { stdio: 'inherit' });
    if (pullResult.status !== 0) {
      console.error('Failed to pull PostgreSQL image');
      return false;
    }
  }
  
  console.log('Running PostgreSQL container with optimized settings...');
  // Use a simple docker run command for speed
  const startResult = spawnSync('docker', [
    'run',
    '--rm',
    '-d',
    '--name', 'postgres-mcp-test',
    '-p', '5432:5432',
    '-e', 'POSTGRES_USER=postgres',
    '-e', 'POSTGRES_PASSWORD=postgres',
    '-e', 'POSTGRES_DB=postgres',
    '-e', 'POSTGRES_SHARED_BUFFERS=128MB',
    '-e', 'POSTGRES_FSYNC=off',
    '--tmpfs', '/var/lib/postgresql/data',
    'postgres:14',
    '-c', 'shared_buffers=128MB',
    '-c', 'fsync=off',
    '-c', 'synchronous_commit=off',
    '-c', 'full_page_writes=off'
  ], { stdio: 'pipe' });
  
  if (startResult.status !== 0) {
    console.error('Failed to start container:');
    console.error(startResult.stderr.toString());
    return false;
  }
  
  const containerId = startResult.stdout.toString().trim();
  console.log(`Container started with ID: ${containerId.substring(0, 12)}`);
  
  // Create sentinel file
  writeFileSync(DOCKER_SENTINEL, new Date().toISOString());
  
  // Wait for PostgreSQL to be ready with better progress indication
  console.log('Waiting for PostgreSQL to be ready:');
  const startTime = Date.now();
  
  for (let i = 0; i < 20; i++) {
    process.stdout.write(`Attempt ${i+1}/20: Checking PostgreSQL readiness... `);
    const healthCheck = spawnSync('docker', ['exec', 'postgres-mcp-test', 'pg_isready', '-U', 'postgres'], { stdio: 'pipe' });
    
    if (healthCheck.status === 0) {
      const elapsedTime = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`✓ ready in ${elapsedTime}s!`);
      return true;
    } else {
      console.log(`✗ not ready (${healthCheck.stderr.toString().trim()})`);
      
      // Log container status
      if (i % 3 === 2) {
        const status = spawnSync('docker', ['ps', '--filter', 'name=postgres-mcp-test', '--format', '{{.Status}}'], { stdio: 'pipe' });
        console.log(`Container status: ${status.stdout.toString().trim() || 'Not found'}`);
        
        // Show the PostgreSQL logs to help debug startup issues
        console.log('Recent container logs:');
        const logs = spawnSync('docker', ['logs', '--tail', '5', 'postgres-mcp-test'], { stdio: 'pipe' });
        console.log(logs.stdout.toString().trim());
      }
    }
    
    await sleep(500); // Shorter wait time
  }
  
  console.error('\nFailed to start PostgreSQL in time - check Docker logs below:');
  console.error(getContainerLogs('postgres-mcp-test'));
  return false;
};

// Export cleanup function
export const cleanupTestDb = async (): Promise<void> => {
  console.log('Running database cleanup...');
  
  if (!isDockerRunning()) {
    console.log('Docker is not running, skipping cleanup');
    return;
  }
  
  try {
    // First try to stop the container by name directly
    process.stdout.write('Stopping PostgreSQL container... ');
    const stopResult = spawnSync('docker', ['stop', 'postgres-mcp-test'], { 
      stdio: 'pipe'
    });
    console.log(stopResult.status === 0 ? 'done' : 'failed or not running');
    
    // Then run docker-compose down to clean up everything
    process.stdout.write('Cleaning up Docker resources... ');
    spawnSync('docker', ['compose', '-f', 'docker-compose.test.yml', 'down', '--remove-orphans'], { 
      stdio: 'pipe'
    });
    console.log('done');
    
    // Double check the container is gone
    process.stdout.write('Verifying container is removed... ');
    const checkResult = spawnSync('docker', ['ps', '-q', '-f', 'name=postgres-mcp-test'], {
      stdio: 'pipe'
    });
    
    // If still running, force remove
    if (checkResult.status === 0 && checkResult.stdout.toString().trim() !== '') {
      console.log('still running, forcing removal');
      spawnSync('docker', ['rm', '-f', 'postgres-mcp-test'], {
        stdio: 'pipe'
      });
    } else {
      console.log('confirmed removed');
    }
  } catch (error) {
    console.error('Error during cleanup:', error);
  } finally {
    // Clean up sentinel file
    if (existsSync(DOCKER_SENTINEL)) {
      try {
        process.stdout.write('Removing sentinel file... ');
        unlinkSync(DOCKER_SENTINEL);
        console.log('done');
      } catch (e) {
        console.log('failed');
      }
    }
  }
};

/**
 * Utility function to retry database operations with backoff
 */
export const retryDatabaseOperation = async <T>(
  operation: () => Promise<T>,
  retries = 3,
  delay = 2000
): Promise<T> => {
  let lastError: unknown;
  
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        console.log(`Database operation failed, retrying (${attempt}/${retries})...`);
        await sleep(delay);
      }
    }
  }
  
  throw lastError;
};

/**
 * Register test resources for cleanup. 
 * This allows resources to be cleaned up even if tests are interrupted.
 */
export const registerTestResources = (resources: TestResources): number => {
  globalTestResources.push(resources);
  return globalTestResources.length - 1;
};

/**
 * Cleanup all resources associated with a test.
 * This function is safe to call multiple times.
 */
export const performCleanup = async (resources: TestResources): Promise<void> => {
  // Only run cleanup once
  if (resources.isCleanedUp) {
    return;
  }
  
  console.log('┌─────────────────────────────────────────────────┐');
  console.log('│ Running test cleanup                            │');
  console.log('└─────────────────────────────────────────────────┘');
  
  try {
    // Close database connection with timeout
    if (resources.sql) {
      console.log('Closing database connection...');
      await Promise.race([
        resources.sql.end(),
        new Promise(resolve => setTimeout(() => {
          console.log('Database connection close timeout reached, continuing...');
          resolve(null);
        }, 3000))
      ]);
      resources.sql = undefined;
    }
    
    if (resources.useDockerDb) {
      // Restore environment variables
      if (resources.originalDbAlias) {
        process.env['DEFAULT_DB_ALIAS'] = resources.originalDbAlias;
      } else {
        delete process.env['DEFAULT_DB_ALIAS'];
      }
      
      // Clean up other environment variables
      delete process.env['DB_ALIASES'];
      delete process.env['DB_MAIN_HOST'];
      delete process.env['DB_MAIN_PORT'];
      delete process.env['DB_MAIN_NAME'];
      delete process.env['DB_MAIN_USER'];
      delete process.env['DB_MAIN_PASSWORD'];
      delete process.env['DB_MAIN_SSL'];
      
      // Cleanup Docker with timeout
      console.log('Cleaning up Docker container...');
      try {
        await Promise.race([
          cleanupTestDb(),
          new Promise((_, reject) => setTimeout(() => {
            console.log('Docker cleanup timeout reached, continuing...');
            reject(new Error('Docker cleanup timeout'));
          }, 5000))
        ]);
      } catch (error) {
        console.error('Docker cleanup error or timeout:', error);
        // Still mark as cleaned up even if Docker cleanup times out
      }
    }
    
    resources.isCleanedUp = true;
    console.log('┌─────────────────────────────────────────────────┐');
    console.log('│ Test cleanup complete                           │');
    console.log('└─────────────────────────────────────────────────┘');
  } catch (error) {
    console.error('Error during cleanup:', error);
    resources.isCleanedUp = true;
  }
};

/**
 * Cleanup function that handles all registered resources
 */
export const cleanupAllResources = async (): Promise<void> => {
  console.log(`Cleaning up ${globalTestResources.length} registered test resources...`);
  
  for (const resources of globalTestResources) {
    await performCleanup(resources);
  }
  
  // Clear the array
  globalTestResources.length = 0;
};

export const setupTestDb = async (): Promise<boolean> => {
  console.log('┌─────────────────────────────────────────────────┐');
  console.log('│ Setting up PostgreSQL database for testing      │');
  console.log('└─────────────────────────────────────────────────┘');
  
  if (!isDockerRunning()) {
    console.error('❌ Docker is not running. Please start Docker and try again.');
    return false;
  }
  
  // First try to clean up any leftover containers
  console.log('Cleaning up any existing test containers...');
  await cleanupTestDb();
  
  // Use the faster startup method
  const success = await startFastDockerDb();
  
  if (success) {
    console.log('┌─────────────────────────────────────────────────┐');
    console.log('│ PostgreSQL Docker container ready for testing   │');
    console.log('└─────────────────────────────────────────────────┘');
  } else {
    console.error('┌─────────────────────────────────────────────────┐');
    console.error('│ Failed to set up PostgreSQL for testing         │');
    console.error('└─────────────────────────────────────────────────┘');
  }
  
  return success;
};

/**
 * Sets up signal handlers for graceful shutdown
 */
export const setupSignalHandlers = (): void => {
  // SIGTERM handler for Docker/CI environments
  process.on('SIGTERM', async () => {
    console.log('Received SIGTERM signal, cleaning up...');
    await cleanupAllResources();
    process.exit(0);
  });
  
  // SIGINT handler for Ctrl+C in terminal
  process.on('SIGINT', async () => {
    console.log('Received SIGINT signal, cleaning up...');
    await cleanupAllResources();
    process.exit(0);
  });
  
  // Handle uncaught exceptions as well
  process.on('uncaughtException', async (error) => {
    console.error('Uncaught exception:', error);
    await cleanupAllResources();
    process.exit(1);
  });
}; 