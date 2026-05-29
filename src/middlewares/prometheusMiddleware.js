const promClient = require("prom-client");

const register = new promClient.Registry();

promClient.collectDefaultMetrics({ register });

const httpRequestDuration = new promClient.Histogram({
    name: "http_request_duration_seconds",
    help: "Duration of HTTP requests in seconds",
    labelNames: ["method", "route", "status_code"],
    buckets: [0.1, 0.5, 1, 2.5, 5, 10],
});

register.registerMetric(httpRequestDuration);

const metricsMiddleware = (req, res, next) => {
    const end = httpRequestDuration.startTimer();

    res.on("finish", () => {
        let route = "unknown";

        if (req.route && req.route.path) {
            route = req.route.path;
        } else if (req.baseUrl) {
            route = req.baseUrl;
        }

        end({
            method: req.method,
            route,
            status_code: res.statusCode,
        });
    });

    next();
};

module.exports = {
    metricsMiddleware,
    register,
};