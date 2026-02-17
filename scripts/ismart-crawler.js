#!/usr/bin/env node

/**
 * iSmart CSV Crawler — Standalone Script
 *
 * Downloads iSmart ticket CSVs from configured URLs via browser automation.
 * Handles Microsoft/Google SSO with interactive MFA support.
 *
 * Usage:
 *   node scripts/ismart-crawler.js                    # Headless crawl (all sources)
 *   node scripts/ismart-crawler.js --interactive      # Visible browser for MFA login
 *   node scripts/ismart-crawler.js --dry-run          # Test config & session only
 *   node scripts/ismart-crawler.js --source "Name"    # Crawl one specific source
 *
 * First-time setup:
 *   1. npm install
 *   2. npx playwright install chromium
 *   3. Set ISMART_CRAWLER_SSO_EMAIL and ISMART_CRAWLER_SSO_PASSWORD in .env
 *   4. Edit scripts/crawler-config.json with your source URLs
 *   5. Run with --interactive to complete MFA the first time
 */

const { chromium } = require('playwright');
const { parse } = require('csv-parse/sync');
const fs = require('fs');
const path = require('path');

// Load .env from project root
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

// ── Paths ──────────────────────────────────────────────────────────────────────

const CONFIG_PATH = path.join(__dirname, 'crawler-config.json');
const STATE_PATH = path.join(__dirname, '.browser-state.json');
const DOWNLOADS_DIR = path.join(__dirname, 'downloads');

// ── CLI Flags ──────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const INTERACTIVE = args.includes('--interactive');
const DRY_RUN = args.includes('--dry-run');
const SOURCE_FLAG_IDX = args.indexOf('--source');
const SOURCE_FILTER = SOURCE_FLAG_IDX !== -1 ? args[SOURCE_FLAG_IDX + 1] : null;

// ── Config ─────────────────────────────────────────────────────────────────────

const SSO_PROVIDER = process.env.ISMART_CRAWLER_SSO_PROVIDER || 'microsoft';
const SSO_EMAIL = process.env.ISMART_CRAWLER_SSO_EMAIL || '';
const SSO_PASSWORD = process.env.ISMART_CRAWLER_SSO_PASSWORD || '';

// ── Column Mapping (mirrors public/js/ismart-upload.js) ────────────────────────

const COLUMN_MAP = {
  referenceId: ['Reference Id', 'reference_id', 'Reference ID', 'Ref Id', 'ref_id', 'INC', 'Incident Number', 'Number'],
  incidentId: ['process_incident_master.id', 'Incident ID', 'incident_id', 'ID'],
  priority: ['Priority', 'priority'],
  shortDescription: ['Short Description', 'short_description', 'Title', 'Summary', 'Subject'],
  description: ['Description', 'description', 'Details', 'Long Description'],
  state: ['State', 'state', 'Status'],
  internalState: ['Internal State', 'internal_state', 'Internal State ID'],
  category: ['category', 'Category'],
  subcategory: ['subcategory', 'Subcategory', 'Sub Category'],
  subcategory2: ['subcategory2', 'Subcategory2', 'Sub Category 2'],
  openedAt: ['Opened At', 'opened_at', 'Created', 'Created Date'],
  updatedAt: ['Updated At', 'updated_at', 'Last Updated'],
  dueDate: ['Due Date', 'due_date', 'Due'],
  openedBy: ['Opened By', 'opened_by', 'Reporter', 'Created By'],
  assignedTo: ['Assigned To', 'assigned_to', 'Assignee', 'process_incident_master.assigned_to'],
  groupName: ['Group Name', 'group_name', 'Support Group', 'Assignment Group'],
  businessService: ['Business Service', 'business_service'],
  impact: ['Impact', 'impact'],
  urgency: ['Urgency', 'urgency'],
  holdReason: ['Hold Reason', 'hold_reason'],
  hasBreached: ['HasBreached', 'has_breached', 'Breached', 'SLA Breached'],
  location: ['Location', 'location', 'Work Location'],
  channel: ['Channel', 'channel', 'Origin'],
  programName: ['Program Name', 'program_name'],
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function log(msg) {
  const ts = new Date().toISOString().replace('T', ' ').substring(0, 19);
  console.log(`[${ts}] ${msg}`);
}

function logError(msg) {
  const ts = new Date().toISOString().replace('T', ' ').substring(0, 19);
  console.error(`[${ts}] ERROR: ${msg}`);
}

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    logError(`Config file not found: ${CONFIG_PATH}`);
    logError('Create it from the template — see scripts/crawler-config.json');
    process.exit(1);
  }
  const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
  const config = JSON.parse(raw);
  if (!config.sources || !Array.isArray(config.sources) || config.sources.length === 0) {
    logError('No sources defined in crawler-config.json');
    process.exit(1);
  }
  return config;
}

function mapCsvRows(records) {
  return records.map((row) => {
    const mapped = {};
    for (const [field, aliases] of Object.entries(COLUMN_MAP)) {
      for (const alias of aliases) {
        if (row[alias] !== undefined && row[alias] !== '') {
          let val = row[alias];
          if (val instanceof Date) {
            val = val.toISOString().replace('T', ' ').substring(0, 19);
          }
          mapped[field] = String(val).trim();
          break;
        }
      }
      if (!mapped[field]) mapped[field] = '';
    }

    // Format due date to YYYY-MM-DD
    if (mapped.dueDate) {
      const d = new Date(mapped.dueDate);
      if (!isNaN(d.getTime())) {
        mapped.dueDate = d.toISOString().split('T')[0];
      }
    }

    // Validation
    mapped._errors = [];
    if (!mapped.referenceId) mapped._errors.push('Missing Reference Id');
    if (!mapped.shortDescription) mapped._errors.push('Missing Short Description');

    return mapped;
  });
}

function waitForEnter(prompt) {
  return new Promise((resolve) => {
    process.stdout.write(prompt);
    process.stdin.setEncoding('utf8');
    process.stdin.once('data', () => {
      resolve();
    });
  });
}

function sanitizeFilename(name) {
  return name.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
}

// ── SSO Detection & Login ──────────────────────────────────────────────────────

function isLoginPage(url) {
  return (
    url.includes('login.microsoftonline.com') ||
    url.includes('accounts.google.com') ||
    url.includes('/login') ||
    url.includes('/signin') ||
    url.includes('/auth')
  );
}

async function isMfaPage(page) {
  const url = page.url();
  if (!url.includes('login.microsoftonline.com') && !url.includes('accounts.google.com')) {
    return false;
  }
  // Check for MFA-related content
  const text = await page.textContent('body').catch(() => '');
  const mfaIndicators = [
    'Approve sign in request',
    'Enter code',
    'Verify your identity',
    'Two-step verification',
    'authenticator',
    'security code',
    'We need more information',
  ];
  return mfaIndicators.some((indicator) => text.toLowerCase().includes(indicator.toLowerCase()));
}

async function performSSOLogin(page) {
  const url = page.url();
  log(`SSO login required (${SSO_PROVIDER}), current URL: ${url}`);

  if (!SSO_EMAIL || !SSO_PASSWORD) {
    logError('SSO credentials not set. Set ISMART_CRAWLER_SSO_EMAIL and ISMART_CRAWLER_SSO_PASSWORD in .env');
    throw new Error('SSO credentials not configured');
  }

  if (SSO_PROVIDER === 'microsoft') {
    await performMicrosoftLogin(page);
  } else if (SSO_PROVIDER === 'google') {
    await performGoogleLogin(page);
  } else {
    throw new Error(`Unsupported SSO provider: ${SSO_PROVIDER}`);
  }
}

async function performMicrosoftLogin(page) {
  // Wait for email input
  try {
    await page.waitForSelector('input[type="email"]', { timeout: 10000 });
    log('Filling email...');
    await page.fill('input[type="email"]', SSO_EMAIL);
    await page.click('input[type="submit"]');
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  } catch {
    log('Email field not found — may already be past email step');
  }

  // Wait for password input
  try {
    await page.waitForSelector('input[type="password"]:visible', { timeout: 10000 });
    log('Filling password...');
    await page.fill('input[type="password"]', SSO_PASSWORD);
    await page.click('input[type="submit"]');
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  } catch {
    log('Password field not found — may already be past password step');
  }

  // Handle MFA if needed
  if (await isMfaPage(page)) {
    if (INTERACTIVE) {
      log('MFA detected — complete it in the browser window');
      await waitForEnter('Press ENTER after completing MFA in the browser...\n');
      await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    } else {
      throw new Error('MFA required — re-run with --interactive to complete MFA manually');
    }
  }

  // Handle "Stay signed in?" prompt
  try {
    const yesBtn = await page.waitForSelector('input[value="Yes"]', { timeout: 5000 });
    if (yesBtn) {
      log('Accepting "Stay signed in" prompt...');
      await yesBtn.click();
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    }
  } catch {
    // No "Stay signed in" prompt — that's fine
  }
}

async function performGoogleLogin(page) {
  try {
    await page.waitForSelector('input[type="email"]', { timeout: 10000 });
    log('Filling email...');
    await page.fill('input[type="email"]', SSO_EMAIL);
    await page.click('#identifierNext');
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  } catch {
    log('Email field not found — may already be past email step');
  }

  try {
    await page.waitForSelector('input[type="password"]:visible', { timeout: 10000 });
    log('Filling password...');
    await page.fill('input[type="password"]', SSO_PASSWORD);
    await page.click('#passwordNext');
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  } catch {
    log('Password field not found — may already be past password step');
  }

  // Handle MFA if needed
  if (await isMfaPage(page)) {
    if (INTERACTIVE) {
      log('MFA detected — complete it in the browser window');
      await waitForEnter('Press ENTER after completing MFA in the browser...\n');
      await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    } else {
      throw new Error('MFA required — re-run with --interactive to complete MFA manually');
    }
  }
}

// ── CSV Download ───────────────────────────────────────────────────────────────

async function downloadCSV(page, source) {
  const selector = source.downloadSelector;

  if (!selector) {
    // No selector configured — try common export patterns
    log('No downloadSelector configured — looking for common export/download elements...');
    const commonSelectors = [
      'a[href*="export"]',
      'a[href*="download"]',
      'a[href*="csv"]',
      'button:has-text("Export")',
      'button:has-text("Download")',
      'a:has-text("Export")',
      'a:has-text("Download CSV")',
      '[data-action="export"]',
      '.export-btn',
      '.download-btn',
    ];

    for (const sel of commonSelectors) {
      const el = await page.$(sel);
      if (el) {
        log(`Found export element: ${sel}`);
        const [download] = await Promise.all([
          page.waitForEvent('download', { timeout: 30000 }),
          el.click(),
        ]);
        return await saveDownload(download, source);
      }
    }

    // If in interactive mode, let the user click the download button
    if (INTERACTIVE) {
      log('Could not auto-detect export button.');
      log('Please click the export/download button in the browser manually.');
      log('TIP: After downloading, note the CSS selector for the button and add it to crawler-config.json');
      const download = await page.waitForEvent('download', { timeout: 120000 });
      return await saveDownload(download, source);
    }

    throw new Error(
      'No downloadSelector configured and could not auto-detect export button. ' +
      'Run with --interactive to identify the selector, then add it to crawler-config.json'
    );
  }

  // Use the configured selector
  log(`Clicking download selector: ${selector}`);
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 30000 }),
    page.click(selector),
  ]);
  return await saveDownload(download, source);
}

async function saveDownload(download, source) {
  const suggestedName = download.suggestedFilename() || 'export.csv';
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
  const safeName = sanitizeFilename(source.name);
  const filename = `${safeName}-${timestamp}-${suggestedName}`;
  const savePath = path.join(DOWNLOADS_DIR, filename);

  await download.saveAs(savePath);
  log(`Downloaded: ${savePath} (${fs.statSync(savePath).size} bytes)`);
  return savePath;
}

// ── Main Crawl Logic ───────────────────────────────────────────────────────────

async function crawlSource(source, context) {
  log(`\n${'='.repeat(60)}`);
  log(`Crawling source: ${source.name}`);
  log(`URL: ${source.url}`);
  log('='.repeat(60));

  const page = await context.newPage();

  try {
    // Navigate to source URL
    log('Navigating to source URL...');
    await page.goto(source.url, { waitUntil: 'networkidle', timeout: 60000 });

    // Check if we need to authenticate
    if (isLoginPage(page.url())) {
      await performSSOLogin(page);

      // After login, navigate to the actual source URL
      if (isLoginPage(page.url())) {
        log('Still on login page after authentication — waiting for redirect...');
        await page.waitForNavigation({ timeout: 30000 }).catch(() => {});
      }

      // If we're still not at the target, navigate again
      if (!page.url().includes(new URL(source.url).hostname)) {
        log('Navigating back to source URL after authentication...');
        await page.goto(source.url, { waitUntil: 'networkidle', timeout: 60000 });
      }
    }

    log(`Page loaded: ${page.url()}`);

    // Check again for unexpected login redirect
    if (isLoginPage(page.url())) {
      if (await isMfaPage(page)) {
        throw new Error('MFA required — re-run with --interactive to complete MFA manually');
      }
      throw new Error('Still on login page after authentication attempt — SSO login may have failed');
    }

    if (DRY_RUN) {
      log('DRY RUN — skipping CSV download');
      log(`Page title: ${await page.title()}`);

      // In interactive mode during dry run, keep the browser open for inspection
      if (INTERACTIVE) {
        log('Browser is open for inspection. Check the page to find the export button selector.');
        await waitForEnter('Press ENTER to close the browser...\n');
      }
      return;
    }

    // Download the CSV
    const csvPath = await downloadCSV(page, source);

    // Parse the CSV
    const csvContent = fs.readFileSync(csvPath, 'utf8');
    const records = parse(csvContent, {
      columns: true,
      skip_empty_lines: true,
      bom: true,
      trim: true,
      relax_column_count: true,
    });

    log(`Parsed ${records.length} rows from CSV`);

    if (records.length === 0) {
      log('No data rows found in CSV');
      return;
    }

    // Show CSV headers
    const headers = Object.keys(records[0]);
    log(`CSV columns (${headers.length}): ${headers.join(', ')}`);

    // Map columns
    const mapped = mapCsvRows(records);
    const valid = mapped.filter((r) => r._errors.length === 0);
    const invalid = mapped.filter((r) => r._errors.length > 0);

    log(`\nMapping results:`);
    log(`  Total rows:   ${mapped.length}`);
    log(`  Valid rows:   ${valid.length}`);
    log(`  Invalid rows: ${invalid.length}`);

    if (invalid.length > 0 && invalid.length <= 10) {
      log(`\nInvalid rows:`);
      invalid.forEach((r, i) => {
        log(`  Row ${i + 1}: ${r._errors.join(', ')}`);
      });
    }

    // Show sample of mapped data
    if (valid.length > 0) {
      log(`\nSample mapped data (first 3 valid rows):`);
      valid.slice(0, 3).forEach((r, i) => {
        const { _errors, ...data } = r;
        const preview = Object.entries(data)
          .filter(([, v]) => v)
          .map(([k, v]) => `${k}: ${v.length > 40 ? v.substring(0, 40) + '...' : v}`)
          .join(', ');
        log(`  [${i + 1}] ${preview}`);
      });
    }

    // Show mapped field coverage
    const fieldsCovered = Object.keys(COLUMN_MAP).filter((field) =>
      valid.some((r) => r[field] && r[field] !== '')
    );
    const fieldsMissing = Object.keys(COLUMN_MAP).filter(
      (field) => !fieldsCovered.includes(field)
    );
    log(`\nField coverage: ${fieldsCovered.length}/${Object.keys(COLUMN_MAP).length}`);
    if (fieldsMissing.length > 0) {
      log(`  Missing fields: ${fieldsMissing.join(', ')}`);
    }

    log(`\nSource "${source.name}" — done`);
  } finally {
    await page.close();
  }
}

async function main() {
  log('iSmart CSV Crawler');
  log(`Mode: ${INTERACTIVE ? 'INTERACTIVE (visible browser)' : 'HEADLESS (automated)'}`);
  if (DRY_RUN) log('DRY RUN enabled — will not download CSVs');

  // Load config
  const config = loadConfig();
  let sources = config.sources;

  // Filter by source name if specified
  if (SOURCE_FILTER) {
    sources = sources.filter((s) => s.name === SOURCE_FILTER);
    if (sources.length === 0) {
      logError(`Source not found: "${SOURCE_FILTER}"`);
      log(`Available sources: ${config.sources.map((s) => s.name).join(', ')}`);
      process.exit(1);
    }
  }

  log(`Sources to crawl: ${sources.map((s) => s.name).join(', ')}`);

  // Check SSO credentials
  if (!SSO_EMAIL || !SSO_PASSWORD) {
    log('WARNING: SSO credentials not set in .env — login will fail if session has expired');
  } else {
    log(`SSO provider: ${SSO_PROVIDER}, email: ${SSO_EMAIL.substring(0, 4)}****`);
  }

  // Check saved session
  if (fs.existsSync(STATE_PATH)) {
    const stat = fs.statSync(STATE_PATH);
    const ageDays = (Date.now() - stat.mtimeMs) / (1000 * 60 * 60 * 24);
    log(`Saved session found (${ageDays.toFixed(1)} days old)`);
    if (ageDays > 60) {
      log('WARNING: Saved session is old — may need to re-authenticate with --interactive');
    }
  } else {
    log('No saved session — will need to authenticate');
    if (!INTERACTIVE && (!SSO_EMAIL || !SSO_PASSWORD)) {
      logError('No session and no SSO credentials. Run with --interactive first.');
      process.exit(1);
    }
  }

  // Ensure downloads directory exists
  if (!fs.existsSync(DOWNLOADS_DIR)) {
    fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
  }

  // Launch browser
  log('\nLaunching browser...');
  const browser = await chromium.launch({
    headless: !INTERACTIVE,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    // Create context with saved session state
    const contextOptions = {
      acceptDownloads: true,
    };
    if (fs.existsSync(STATE_PATH)) {
      log('Restoring saved session...');
      contextOptions.storageState = STATE_PATH;
    }
    const context = await browser.newContext(contextOptions);

    // Crawl each source
    for (const source of sources) {
      try {
        await crawlSource(source, context);
      } catch (err) {
        logError(`Failed to crawl "${source.name}": ${err.message}`);
        if (err.message.includes('MFA required') || err.message.includes('re-run with --interactive')) {
          // Clear saved session on auth failure
          if (fs.existsSync(STATE_PATH)) {
            log('Clearing expired session state...');
            fs.unlinkSync(STATE_PATH);
          }
        }
      }
    }

    // Save session state after all crawls
    log('\nSaving session state...');
    await context.storageState({ path: STATE_PATH });
    log(`Session saved to ${STATE_PATH}`);
  } finally {
    await browser.close();
    log('\nBrowser closed. Done.');
  }
}

// ── Run ────────────────────────────────────────────────────────────────────────

main().catch((err) => {
  logError(`Fatal: ${err.message}`);
  process.exit(1);
});
