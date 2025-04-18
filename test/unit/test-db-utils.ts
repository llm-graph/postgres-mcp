import { spawnSync } from 'child_process';
import { sleep } from 'bun';
import { writeFileSync, existsSync, unlinkSync } from 'fs';
import { join } from 'path';
import postgres from 'postgres';

const DOCKER_SENTINEL = join(process.cwd(), '.docker-container-running');

export type TestResources = {
  sql?: postgres.Sql<{}>;
  useDockerDb: boolean;
  originalDbAlias?: string;
  isCleanedUp: boolean;
  dbConfig?: any;
};

const globalTestResources: TestResources[] = [];

export const isDockerRunning = (): boolean => {
  process.stdout.write('Checking if Docker is running... ');
  const result = spawnSync('docker', ['info'], { stdio: 'pipe' });
  const isRunning = result.status === 0;
  console.log(isRunning ? 'yes' : 'no');
  return isRunning;
};

export const isImagePulled = (imageName: string): boolean => {
  process.stdout.write(`Checking if ${imageName} image exists... `);
  const result = spawnSync('docker', ['images', '-q', imageName], { stdio: 'pipe' });
  const isPulled = result.status === 0 && result.stdout.toString().trim() !== '';
  console.log(isPulled ? 'yes' : 'no');
  return isPulled;
};

export const getContainerLogs = (containerName: string): string => {
  console.log(`Getting logs for container ${containerName}...`);
  const result = spawnSync('docker', ['logs', containerName], { stdio: 'pipe' });
  return result.stdout.toString();
};

export const startFastDockerDb = async (): Promise<boolean> => {
  console.log('Fast-starting PostgreSQL container...');
  
  if (!isImagePulled('postgres:14')) {
    console.log('Pulling PostgreSQL image...');
    const pullResult = spawnSync('docker', ['pull', 'postgres:14'], { stdio: 'inherit' });
    if (pullResult.status !== 0) {
      console.error('Failed to pull PostgreSQL image');
      return false;
    }
  }
  
  console.log('Running PostgreSQL container with optimized settings...');
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
  
  writeFileSync(DOCKER_SENTINEL, new Date().toISOString());
  
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
      
      if (i % 3 === 2) {
        const status = spawnSync('docker', ['ps', '--filter', 'name=postgres-mcp-test', '--format', '{{.Status}}'], { stdio: 'pipe' });
        console.log(`Container status: ${status.stdout.toString().trim() || 'Not found'}`);
        
        console.log('Recent container logs:');
        const logs = spawnSync('docker', ['logs', '--tail', '5', 'postgres-mcp-test'], { stdio: 'pipe' });
        console.log(logs.stdout.toString().trim());
      }
    }
    
    await sleep(500);
  }
  
  console.error('\nFailed to start PostgreSQL in time - check Docker logs below:');
  console.error(getContainerLogs('postgres-mcp-test'));
  return false;
};

export const cleanupTestDb = async (): Promise<void> => {
  console.log('Running database cleanup...');
  
  if (!isDockerRunning()) {
    console.log('Docker is not running, skipping cleanup');
    return;
  }
  
  try {
    process.stdout.write('Stopping PostgreSQL container... ');
    const stopResult = spawnSync('docker', ['stop', 'postgres-mcp-test'], { 
      stdio: 'pipe'
    });
    console.log(stopResult.status === 0 ? 'done' : 'failed or not running');
    
    process.stdout.write('Cleaning up Docker resources... ');
    spawnSync('docker', ['compose', '-f', 'docker-compose.test.yml', 'down', '--remove-orphans'], { 
      stdio: 'pipe'
    });
    console.log('done');
    
    process.stdout.write('Verifying container is removed... ');
    const checkResult = spawnSync('docker', ['ps', '-q', '-f', 'name=postgres-mcp-test'], {
      stdio: 'pipe'
    });
    
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
  console.log('Setting up test database environment...');
  
  if (!isDockerRunning()) {
    console.error('Docker is not running. Please start Docker and try again.');
    return false;
  }
  
  console.log('Docker is running, checking for existing container...');
  
  const existingContainer = spawnSync('docker', ['ps', '-q', '-f', 'name=postgres-mcp-test'], {
    stdio: 'pipe'
  });
  
  if (existingContainer.status === 0 && existingContainer.stdout.toString().trim() !== '') {
    console.log('Found existing container. Stopping it first...');
    await cleanupTestDb();
  }
  
  return startFastDockerDb();
}; 