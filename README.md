## Wheel Hunt
A simple automation script to search used cars on Facebook Marketplace, filter out dealer listings, and save valid links to a CSV file.

## Requirements
- Node.js `v22.14.0` or higher
- npm `v10.x`
- Chrome-compatible environment (Playwright uses Chromium)

## Setup
1. Clone the repo:
    git clone https://github.com/PrajilPradeep/wheel-hunt.git
    cd wheel-hunt

2. Install dependencies:
    npm install

3. Compile TypeScript:
    npx tsc

## Usage
Run the script:
**npm run hunt**

First time: log in manually when prompted, then press Enter in the terminal.
Enter location and car model when asked.
Results will be saved to the exports folder as a .csv file.
