import { chromium, BrowserContext, Page } from 'playwright';
import * as fs from 'fs';
import * as csvWriter from 'csv-writer';
import * as path from 'path';
import * as readline from 'readline'

const COOKIE_PATH = './cookies.json';

function askQuestion(query: string): Promise<string>{
  const rl = readline.createInterface({
    input:process.stdin,
    output: process.stdout
  });
  return new Promise(resolve => rl.question(query, answer =>{
    rl.close()
    const trimmed = answer.trim();
    if(!trimmed){
      console.log("`❌ Invalid input. Exiting !!!`");
      process.exit(1)
    }
    resolve(trimmed);
  }));
}

async function saveCookies(context: BrowserContext) {
  const cookies = await context.cookies();
  fs.writeFileSync(COOKIE_PATH, JSON.stringify(cookies, null, 2));
}

async function loadCookies(context: BrowserContext) {
  if (fs.existsSync(COOKIE_PATH)) {
    const cookies = JSON.parse(fs.readFileSync(COOKIE_PATH, 'utf-8'));
    await context.addCookies(cookies);
  }
}

async function manualLogin(context: BrowserContext) {
  const page = await context.newPage();
  await page.goto('https://www.facebook.com/');
  console.log("Log in manually in the opened browser, then press Enter here...");
  await new Promise(resolve => process.stdin.once('data', resolve));
  await saveCookies(context);
  await page.close();
}

//Todo - Fix bug when the location is set already
// async function setLocationAndSearch(page:Page, location:string, query:string) {
//   // Set Location
//   await page.goto('https://www.facebook.com/marketplace');
//   await page.waitForLoadState('domcontentloaded');

//   await page.waitForSelector('input[placeholder="Location"]');
//   await page.click('input[placeholder="Location"]');
//   await page.fill('input[placeholder="Location"]', location);
//   await page.waitForSelector('ul[role="listbox"] li', { timeout: 5000 });
//   await page.click('ul[role="listbox"] li:first-child');
//   await page.waitForTimeout(2000);

//   // Set Search Query
//   await page.waitForSelector('input[placeholder="Search Marketplace"]');
//   await page.fill('input[placeholder="Search Marketplace"]', query);
//   await page.keyboard.press('Enter');
//   await page.waitForNavigation({ waitUntil: 'domcontentloaded' });
// }


async function searchMarketplace(context: BrowserContext, query: string, location:string) {
  const page = await context.newPage();

  //Todo - implement the following function
  // await setLocationAndSearch(page, location, query);
  // await page.waitForTimeout(3000);

  const searchQuery = encodeURIComponent(query);
  const url = `https://www.facebook.com/marketplace/delhi/search?query=${searchQuery}`;
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);

  const adLinks = new Set<string>();
  let maxScrolls = 20; // Limit to prevent infinite loops

  for (let i = 0; i < maxScrolls && adLinks.size < 100; i++) {
    const newLinks = await page.$$eval('a[href^="/marketplace/item/"]', anchors => {
      return anchors
        .filter((a): a is HTMLAnchorElement => a instanceof HTMLAnchorElement)
        .map(a => a.href);
    });

  newLinks.forEach(link => adLinks.add(link));

  // Scroll to the bottom of the page
  await page.evaluate(() => {
    window.scrollBy(0, window.innerHeight);
  });

  await page.waitForTimeout(2000); // Wait for new content to load
}

  const finalResult = [];

  for (const adUrl of Array.from(adLinks)) {
      try {
          await page.goto(adUrl, { waitUntil: 'domcontentloaded' });

          // Wait for Seller Information block
          await page.waitForSelector('a[href*="/marketplace/profile/"]', { timeout: 5000 });

          // Extract seller profile URL
          const sellerUrl = await page.$eval('a[href*="/marketplace/profile/"]', el => {
            if (el instanceof HTMLAnchorElement) {
              return el.href;
            }
            throw new Error("Element is not an anchor element");
          });
          console.log(`Checking Seller Profile: ${sellerUrl}`);

          // Navigate to Seller's profile
          await page.goto(sellerUrl, { waitUntil: 'domcontentloaded' });

          // Give some time for listings to load
          await page.waitForTimeout(3000);

          // Wait for modal to appear
          await page.waitForSelector('div[role="dialog"]', { timeout: 5000 });

          // Count only the seller's listings inside the modal
          const listingCount = await page.$$eval(
            'div[role="dialog"] a[href^="/marketplace/item/"]',
            links => links.length
          );
          console.log(`Listings found: ${listingCount}`);

          if (listingCount <= 3) {
              finalResult.push(adUrl);
              console.log(`✅ Valid non-dealer car found: ${adUrl}`);
          } else {
              console.log(`❌ Discarded Dealer: ${adUrl}`);
          }

      } catch (err) {
          if (err instanceof Error) {
            console.log(`Error processing ${adUrl}: ${err.message}`);
          } else {
            console.log(`Error processing ${adUrl}: ${err}`);
          }
      }
  }

  await page.close();
  return finalResult;
}

async function saveResultsToCSV(results:string[], query:string) {
  if (results.length === 0) {
    console.log("No valid non-dealer cars found.");
    return;
  }

  const outputDir = path.join(process.cwd(), 'exports');
  if(!fs.existsSync(outputDir)){
    fs.mkdirSync(outputDir)
  }

  const createCsvWriter = csvWriter.createObjectCsvWriter;
  const timestamp = new Date().toISOString().slice(0,10)
  const safeQuery = query.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_]/g,"")
  const filePath = path.join(outputDir, `fb-results-${safeQuery}_${timestamp}.csv`);

  const writer = createCsvWriter({
    path: filePath,
    header: [
      { id: 'url', title: 'URL'}
    ]
  });

  const formattedResults = results.map(url=> ({ url }));

  await writer.writeRecords(formattedResults);
  console.log("Results saved to",filePath);
}

async function main() {
  const location = await askQuestion("📍 Enter location: ");
  const query = await askQuestion("🚗 Enter car model: ");

  const browser = await chromium.launch({ headless: true});
  const context = await browser.newContext();

  if (!fs.existsSync(COOKIE_PATH)) {
    await manualLogin(context);
  } else {
    await loadCookies(context);
  }

  const results = await searchMarketplace(context, query, location);
  await saveResultsToCSV(results, query);

  await context.close()
  await browser.close();
}

main();
