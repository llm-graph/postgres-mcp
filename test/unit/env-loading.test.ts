import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { loadEnvFile } from '../../src/utils';
import * as fs from 'fs';
import * as path from 'path';

describe('Environment Loading', () => {
  const originalEnv = { ...process.env };
  const testDir = path.join(process.cwd(), 'test-env-files');
  
  beforeEach(() => {
    // Create test directory
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir);
    }
    
    // Reset process.env to original state
    process.env = { ...originalEnv };
    process.env.NODE_ENV = undefined;
    
    // Mock process.cwd to return our test directory
    const originalCwd = process.cwd;
    global.process.cwd = () => testDir;
  });
  
  afterEach(() => {
    // Clean up test files
    if (fs.existsSync(path.join(testDir, '.env'))) {
      fs.unlinkSync(path.join(testDir, '.env'));
    }
    
    if (fs.existsSync(path.join(testDir, '.env.development'))) {
      fs.unlinkSync(path.join(testDir, '.env.development'));
    }
    
    if (fs.existsSync(path.join(testDir, '.env.local'))) {
      fs.unlinkSync(path.join(testDir, '.env.local'));
    }
    
    if (fs.existsSync(path.join(testDir, '.env.production'))) {
      fs.unlinkSync(path.join(testDir, '.env.production'));
    }
    
    // Clean up test directory
    if (fs.existsSync(testDir)) {
      fs.rmdirSync(testDir);
    }
    
    // Restore process.env
    process.env = originalEnv;
  });
  
  test('loads .env.development when NODE_ENV is development', () => {
    // Create test .env.development file
    fs.writeFileSync(path.join(testDir, '.env.development'), 'TEST_VAR=development');
    
    // Set NODE_ENV
    process.env.NODE_ENV = 'development';
    
    // Test loadEnvFile function
    const result = loadEnvFile('development');
    
    // Verify result
    expect(result.path).toBe('.env.development');
    expect(result.loaded).toBe(true);
    expect(process.env.TEST_VAR).toBe('development');
  });
  
  test('loads .env.production when NODE_ENV is production', () => {
    // Create test .env.production file
    fs.writeFileSync(path.join(testDir, '.env.production'), 'TEST_VAR=production');
    
    // Set NODE_ENV
    process.env.NODE_ENV = 'production';
    
    // Test loadEnvFile function
    const result = loadEnvFile('production');
    
    // Verify result
    expect(result.path).toBe('.env.production');
    expect(result.loaded).toBe(true);
    expect(process.env.TEST_VAR).toBe('production');
  });
  
  test('falls back to .env.local when environment-specific file not found', () => {
    // Create test .env.local file
    fs.writeFileSync(path.join(testDir, '.env.local'), 'TEST_VAR=local');
    
    // Set NODE_ENV to a value we don't have a file for
    process.env.NODE_ENV = 'staging';
    
    // Test loadEnvFile function
    const result = loadEnvFile('staging');
    
    // Verify result
    expect(result.path).toBe('.env.local');
    expect(result.loaded).toBe(true);
    expect(process.env.TEST_VAR).toBe('local');
  });
  
  test('falls back to .env when no other files found', () => {
    // Create test .env file
    fs.writeFileSync(path.join(testDir, '.env'), 'TEST_VAR=default');
    
    // Set NODE_ENV to a value we don't have a file for
    process.env.NODE_ENV = 'staging';
    
    // Test loadEnvFile function
    const result = loadEnvFile('staging');
    
    // Verify result
    expect(result.path).toBe('.env');
    expect(result.loaded).toBe(true);
    expect(process.env.TEST_VAR).toBe('default');
  });
  
  test('returns loaded=false when no env files found', () => {
    // Don't create any env files
    
    // Test loadEnvFile function
    const result = loadEnvFile('development');
    
    // Verify result
    expect(result.path).toBe('.env');
    expect(result.loaded).toBe(false);
  });
}); 