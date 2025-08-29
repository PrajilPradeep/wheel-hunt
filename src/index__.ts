import { chromium, BrowserContext, Page } from 'playwright';
import * as fs from 'fs';
import * as csvWriter from 'csv-writer';
import * as path from 'path';
import * as readline from 'readline';

interface CarListing {
  url: string;
  sellerName: string;
  price: string;
  title: string;
}

const COOKIE_PATH = './olx-cookies.json';

function askQuestion(query: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  return new Promise(resolve => rl.question(query, answer => {
    rl.close();
    const trimmed = answer.trim();
    if (!trimmed) {
      console.log("❌ Invalid input. Exiting !!!");
      process.exit(1);
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

async function searchOLX(context: BrowserContext, query: string, location: string) {
  const page = await context.newPage();

  const searchQuery = encodeURIComponent(query);
  const locationQuery = encodeURIComponent(location);
  const url = `https://www.olx.in/cars_c84/q-${searchQuery}?search%5Bfilter_enum_location%5D%5B0%5D=${locationQuery}&filter=petrol_eq_diesel%2Cyear_between_2018_to_2019`;

  console.log(`🔍 Searching OLX for: ${query} in ${location}`);
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);

  const adLinks = new Set<string>();
  let maxScrolls = 10;

  // Scroll and collect ad links
  for (let i = 0; i < maxScrolls && adLinks.size < 20; i++) {
    debugger
    console.log("Prajil scrollCount is:",i)
    const newLinks = await page.$$eval('li[data-aut-id="itemBox2"]>a', anchors => {
      return anchors
        .filter((a): a is HTMLAnchorElement => a instanceof HTMLAnchorElement)
        .map(a => a.href);
    });
    console.log("Prajil newLinks are:",newLinks)

    newLinks.forEach(link => adLinks.add(link));

    // Scroll to load more content
    await page.evaluate(() => {
      window.scrollBy(0, window.innerHeight);
    });

    await page.waitForTimeout(2000);
  }

  console.log(`📊 Found ${adLinks.size} car listings. adLinks are:`,adLinks);
  const finalResult: CarListing[] = [];

  for (const adUrl of Array.from(adLinks)) {
    try {
      await page.goto(adUrl, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(2000);

      // Check seller's items listed count directly from the item page
      const sellerInfo = await page.evaluate(() => {
        // Get seller name
        const sellerNameEl = document.querySelector('div[data-aut-id="userTitle"] span:nth-of-type(2)')
        const sellerName = sellerNameEl?.textContent?.trim() || "N/A";

        // Get items listed count
        const itemsListedEl = document.querySelector('div[data-aut-id="propertiesValue"]');
        const itemsListed = itemsListedEl?.textContent?.trim() || "0";

        return {
          sellerName,
          itemsListed: parseInt(itemsListed) || 0
        };
      });

      console.log(`📊 Seller: ${sellerInfo.sellerName} has ${sellerInfo.itemsListed} items listed`);

      // If seller has more than 3 items listed, consider them a dealer
      if (sellerInfo.itemsListed > 3) {
        console.log(`❌ Discarded dealer (${sellerInfo.itemsListed} items): ${sellerInfo.sellerName}`);
        continue;
      }

      // Extract seller information
      const sellerName = sellerInfo.sellerName

      // Extract car details
      const title = await page.evaluate(() => {
        const titleEl = document.querySelector('h1[data-aut-id="itemTitle"]');
        return titleEl?.textContent?.trim() || "N/A";
      });

      const price = await page.evaluate(() => {
        const priceEl = document.querySelector('div[data-aut-id="itemPrice"]');
        return priceEl?.textContent?.trim() || "N/A";
      });

//       const description = await page.$$eval(
//   'div[data-aut-id="itemDescripton"]',
//   nodes => nodes
//     .map(n => n.textContent?.trim())
//     .filter(Boolean) // removes empty strings or nulls
//     .join('\n')
// );

        finalResult.push({
          url: adUrl,
          sellerName: sellerName,
          price: price,
          title: title,
        });
        console.log(`✅ Valid individual seller found`);


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

async function saveResultsToCSV(results:CarListing[], query:string) {
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
      { id: 'url', title: 'Link' },
      { id: 'sellerName', title: 'Seller\'s Name' },
      { id: 'price', title: 'Price' },
      { id: 'title', title: 'Title' },
    ]
  });

  await writer.writeRecords(results);
  console.log("Results saved to",filePath);
}

async function main() {
  const location = await askQuestion("📍 Enter location (e.g., Delhi, Mumbai, Bangalore): ");
  const query = await askQuestion("🚗 Enter car model (e.g., Swift, Innova, City): ");

  const browser = await chromium.launch({
    headless: false, // Set to true for production
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const context = await browser.newContext({
    viewport: { width: 1366, height: 768 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
  });

  await loadCookies(context);

  try {
    const results = await searchOLX(context, query, location);
    await saveResultsToCSV(results, query);
  } catch (error) {
    console.error("Error during scraping:", error);
  } finally {
    await saveCookies(context);
    await context.close();
    await browser.close();
  }
}

main().catch(console.error);
