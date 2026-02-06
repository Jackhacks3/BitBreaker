#!/usr/bin/env node

/**
 * Database Migration Script
 * 
 * Runs SQL migration files in order to apply database optimizations,
 * indexes, views, and functions that aren't auto-created by database.js
 * 
 * Usage:
 *   npm run migrate
 *   node src/migrate.js
 */

import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import dotenv from 'dotenv'
import pg from 'pg'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Load environment variables: project root .env first, then backend/.env
dotenv.config({ path: join(__dirname, '../../.env') })
dotenv.config()

const { Pool } = pg

// Migration files in order
const migrations = [
  { name: '002_wallets.sql', file: 'migrations/002_wallets.sql' },
  { name: '003_one_attempt.sql', file: 'migrations/003_one_attempt.sql' }
]

/**
 * Check if migration has been run
 */
async function checkMigrationRun(pool, migrationName) {
  try {
    // Create migrations table if it doesn't exist
    await pool.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) UNIQUE NOT NULL,
        executed_at TIMESTAMP DEFAULT NOW()
      )
    `)

    const result = await pool.query(
      'SELECT name FROM schema_migrations WHERE name = $1',
      [migrationName]
    )
    return result.rows.length > 0
  } catch (error) {
    console.error(`[MIGRATE] Error checking migration status:`, error.message)
    throw error
  }
}

/**
 * Mark migration as executed
 */
async function markMigrationRun(pool, migrationName) {
  await pool.query(
    'INSERT INTO schema_migrations (name) VALUES ($1) ON CONFLICT (name) DO NOTHING',
    [migrationName]
  )
}

/**
 * Run a single migration file
 */
async function runMigration(pool, migration) {
  const filePath = join(__dirname, migration.file)
  
  try {
    console.log(`[MIGRATE] Reading ${migration.name}...`)
    const sql = readFileSync(filePath, 'utf-8')
    
    console.log(`[MIGRATE] Executing ${migration.name}...`)
    await pool.query(sql)
    
    await markMigrationRun(pool, migration.name)
    console.log(`[MIGRATE] ✅ ${migration.name} completed successfully`)
  } catch (error) {
    // Check if it's a "already exists" error (safe to ignore)
    if (error.message.includes('already exists') || 
        error.message.includes('duplicate key') ||
        error.code === '42P07' || // duplicate_table
        error.code === '42710') { // duplicate_object
      console.log(`[MIGRATE] ⚠️  ${migration.name} - objects already exist (skipping)`)
      await markMigrationRun(pool, migration.name)
      return
    }
    
    console.error(`[MIGRATE] ❌ ${migration.name} failed:`, error.message)
    throw error
  }
}

/**
 * Main migration function
 */
async function migrate() {
  const databaseUrl = process.env.DATABASE_URL

  if (!databaseUrl) {
    console.error('[MIGRATE] ❌ DATABASE_URL not set in environment')
    console.error('[MIGRATE] Set DATABASE_URL or use in-memory database (migrations skipped)')
    process.exit(1)
  }

  // Check if using mock database
  if (process.env.USE_MOCK_DB === 'true') {
    console.log('[MIGRATE] ⚠️  USE_MOCK_DB=true - skipping migrations (using in-memory database)')
    process.exit(0)
  }

  let pool
  try {
    console.log('[MIGRATE] Connecting to database...')
    
    const sslDisabled = process.env.DATABASE_SSL === '0' || process.env.DATABASE_SSL === 'false'
    const urlRequiresSsl = databaseUrl.includes('sslmode=require')
    const useSsl = !sslDisabled && (process.env.NODE_ENV === 'production' || urlRequiresSsl)

    pool = new Pool({
      connectionString: databaseUrl,
      ssl: useSsl ? { rejectUnauthorized: false } : false
    })

    // Test connection
    await pool.query('SELECT 1')
    console.log('[MIGRATE] ✅ Database connection established')

    // Run migrations in order
    for (const migration of migrations) {
      const alreadyRun = await checkMigrationRun(pool, migration.name)
      
      if (alreadyRun) {
        console.log(`[MIGRATE] ⏭️  ${migration.name} already executed (skipping)`)
        continue
      }

      await runMigration(pool, migration)
    }

    console.log('[MIGRATE] ✅ All migrations completed successfully')
  } catch (error) {
    console.error('[MIGRATE] ❌ Migration failed:', error.message)
    process.exit(1)
  } finally {
    if (pool) {
      await pool.end()
    }
  }
}

// Run migrations
migrate().catch((error) => {
  console.error('[MIGRATE] Fatal error:', error)
  process.exit(1)
})
