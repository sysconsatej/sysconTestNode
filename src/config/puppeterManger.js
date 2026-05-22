const puppeteer = require("puppeteer");

let browserInstance = null;

async function getBrowser() {
    if (browserInstance) return browserInstance;

    browserInstance = await puppeteer.launch({
        headless: true,
        protocolTimeout: 900000,
        args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage",
            "--disable-gpu",
        ],
        executablePath:  "/usr/bin/chromium-browser",
    });

    browserInstance.on("disconnected", () => {
        console.log("Browser disconnected. Resetting...");
        browserInstance = null;
    });

    return browserInstance;
}

async function createPage() {
    const browser = await getBrowser();
    const page = await browser.newPage();

    return page;
}



module.exports = { getBrowser, createPage };