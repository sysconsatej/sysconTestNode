const fetch = require("node-fetch");
const { createPage } = require("../config/puppeterManger");



let tailwindCSSPromise = null;

async function getTailwindCSS() {
    if (tailwindCSSPromise) return tailwindCSSPromise;

    tailwindCSSPromise = fetch(
        "https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css",
    )
        .then((res) => res.text())
        .catch((err) => {
            // if fetch fails, reset so next request can retry
            tailwindCSSPromise = null;
            throw err;
        });

    return tailwindCSSPromise;
}


module.exports = {
    localPDFReports: async (req, res) => {
        let page;

        try {
            const {
                htmlContent = "",
                orientation = "portrait",
                pdfFilename = "report",
            } = req.body || {};

            if (!htmlContent || typeof htmlContent !== "string") {
                return res.status(400).json({
                    success: false,
                    message: "htmlContent is required",
                });
            }

            const tailwindCSS = await getTailwindCSS();

            const fullStyledHtml = `
      <!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <style>
            ${tailwindCSS}

            html, body {
              margin: 0;
              padding: 0;
              font-family: Arial, Helvetica, sans-serif;
              -webkit-print-color-adjust: exact;
              print-color-adjust: exact;
            }

            * {
              box-sizing: border-box;
            }

            @page {
              size: A4 ${orientation === "landscape" ? "landscape" : "portrait"};
              margin: 10px;
            }
          </style>
        </head>
        <body>${htmlContent}</body>
      </html>
    `;

            page = await createPage();

            await page.setViewport({
                width: 1400,
                height: 900,
                deviceScaleFactor: 1,
            });

            // ✅ Block unnecessary heavy requests
            await page?.setRequestInterception(true);
            page?.on("request", (request) => {
                const url = request.url();
                const type = request.resourceType();

                if (
                    type === "font" ||
                    url.includes("fonts.googleapis.com") ||
                    url.includes("fonts.gstatic.com") ||
                    url.includes("google-analytics") ||
                    url.includes("gtag")
                ) {
                    return request.abort();
                }

                return request.continue();
            });

            await page.emulateMediaType("screen");

            await page.setContent(fullStyledHtml, {
                waitUntil: "domcontentloaded",
                timeout: 0,
            });

            // ✅ Safe image loading
            await page.evaluate(async () => {
                const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

                const images = Array.from(document.images || []);

                await Promise.all(
                    images.map((img) => {
                        if (img.complete) return;

                        return Promise.race([
                            new Promise((resolve) => {
                                img.onload = resolve;
                                img.onerror = resolve;
                            }),
                            sleep(15000),
                        ]);
                    })
                );

                await new Promise((resolve) =>
                    requestAnimationFrame(() =>
                        requestAnimationFrame(resolve)
                    )
                );
            });

            // ✅ Optional debug
            const metrics = await page.evaluate(() => ({
                nodeCount: document.getElementsByTagName("*").length,
                imgCount: document.images.length,
                htmlSize: document.documentElement.outerHTML.length,
            }));


            const pdfBuffer = await page.pdf({
                format: "A4",
                landscape: orientation === "landscape",
                printBackground: true,
                preferCSSPageSize: true,
                margin: {
                    top: "10px",
                    right: "10px",
                    bottom: "10px",
                    left: "10px",
                },
                timeout: 0,
                waitForFonts: false,
                tagged: false,
                outline: false,
                scale: 0.95,
            });

            res.setHeader("Content-Type", "application/pdf");
            res.setHeader(
                "Content-Disposition",
                `attachment; filename="${pdfFilename}.pdf"`
            );

            return res.end(Buffer.from(pdfBuffer), "binary");

        } catch (error) {

            return res.status(500).json({
                success: false,
                message: error.message || "An error occurred while generating the PDF",
            });

        } finally {
            if (page) {
                try {
                    await page.close();
                } catch (err) {
                    console.error("Error closing page:", err);
                }
            }
        }
    },


};
// by aakash yadav testing code . 
