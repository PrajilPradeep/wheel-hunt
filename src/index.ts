import { chromium, BrowserContext } from 'playwright';
import * as fs from 'fs';
import * as csvWriter from 'csv-writer';

const COOKIE_PATH = './cookies.json';

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

async function searchMarketplace(context: BrowserContext, query: string, location:string) {
  const page = await context.newPage();

  // Navigate to Marketplace with location parameter
  await page.goto(`https://www.facebook.com/marketplace/delhi/search?query=creta%201.4%20diesel`)
  await page.waitForTimeout(3000);

  await page.waitForSelector('a[href^="/marketplace/item/"]');
  // Extract links
  let adLinks = await page.$$eval('a[href^="/marketplace/item/"]', anchors => {
      return anchors
          .filter((a): a is HTMLAnchorElement => a instanceof HTMLAnchorElement)
          .map(a => a.href);
  });

  const finalResult = [];

  for (const adUrl of adLinks) {
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

async function saveResultsToCSV(results:string[]) {
  if (results.length === 0) {
    console.log("No valid non-dealer cars found.");
    return;
  }

  const createCsvWriter = csvWriter.createObjectCsvWriter;
  const writer = createCsvWriter({
    path: './data/results.csv',
    header: [
      { id: 'url', title: 'URL'}
    ]
  });

  const formattedResults = results.map(url=> ({ url }));

  await writer.writeRecords(formattedResults);
  console.log("Results saved to results.csv");
}

async function main() {
  const location = process.argv[2] || 'Calicut';
  const query = process.argv[3] || 'Honda City';

  const browser = await chromium.launch({ headless: false, slowMo:500 });
  const context = await browser.newContext();

  if (!fs.existsSync(COOKIE_PATH)) {
    await manualLogin(context);
  } else {
    await loadCookies(context);
  }

  const results = await searchMarketplace(context, query, location);
  await saveResultsToCSV(results);

  await context.close()
  await browser.close();
}

main();
