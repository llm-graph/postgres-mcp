import { spawnSync } from 'child_process';
import { sleep } from 'bun';

const isDockerRunning = (): boolean => {
  const result = spawnSync('docker', ['info']);
  return result.status === 0;
};

const startDockerDb = async (): Promise<boolean> => {
  console.log('Starting PostgreSQL in Docker container...');
  
  // Stop and remove container if it exists
  spawnSync('docker', ['compose', '-f', 'docker-compose.test.yml', 'down'], { stdio: 'inherit' });
  
  // Start the container
  const startResult = spawnSync('docker', ['compose', '-f', 'docker-compose.test.yml', 'up', '-d'], { stdio: 'inherit' });
  
  if (startResult.status !== 0) {
    console.error('Failed to start Docker container');
    return false;
  }
  
  // Wait for PostgreSQL to be ready
  console.log('Waiting for PostgreSQL to be ready...');
  for (let i = 0; i < 30; i++) {
    const healthCheck = spawnSync('docker', ['exec', 'postgres-mcp-test', 'pg_isready', '-U', 'postgres']);
    if (healthCheck.status === 0) {
      console.log('PostgreSQL is ready!');
      return true;
    }
    await sleep(1000);
  }
  
  console.error('PostgreSQL did not become ready in time');
  return false;
};

const stopDockerDb = (): void => {
  console.log('Stopping PostgreSQL Docker container...');
  spawnSync('docker', ['compose', '-f', 'docker-compose.test.yml', 'down'], { stdio: 'inherit' });
};

export const setupTestDb = async (): Promise<boolean> => {
  if (!isDockerRunning()) {
    console.error('Docker is not running!');
    return false;
  }
  
  return await startDockerDb();
};

export const cleanupTestDb = (): void => {
  if (isDockerRunning()) {
    stopDockerDb();
  }
}; 