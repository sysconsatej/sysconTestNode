const puppeteer = require("puppeteer");
const os = require("node:os")

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
        executablePath: os.platform() === "linux" ? "/usr/bin/chromium-browser" : undefined,
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