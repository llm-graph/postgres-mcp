import { spawnSync } from 'child_process';
import { sleep } from 'bun';
import { writeFileSync, existsSync, unlinkSync } from 'fs';
import { join } from 'path';

// Use a sentinel file to track if Docker container is running
const DOCKER_SENTINEL = join(process.cwd(), '.docker-container-running');

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

// Keep the exit handler for safety but make it async
const asyncCleanupHandler = async () => {
  console.log('Running final cleanup on exit...');
  if (existsSync(DOCKER_SENTINEL) && isDockerRunning()) {
    await cleanupTestDb();
  }
};

// Register cleanup handler
process.on('exit', () => {
  // On exit we need to use the sync version
  if (existsSync(DOCKER_SENTINEL) && isDockerRunning()) {
    console.log('Final cleanup on exit...');
    spawnSync('docker', ['compose', '-f', 'docker-compose.test.yml', 'down'], { stdio: 'pipe' });
    try {
      unlinkSync(DOCKER_SENTINEL);
    } catch (e) {
      // Ignore
    }
  }
});

// Also register for SIGINT and SIGTERM for cleaner shutdowns
process.on('SIGINT', async () => {
  await asyncCleanupHandler();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await asyncCleanupHandler();
  process.exit(0);
}); 