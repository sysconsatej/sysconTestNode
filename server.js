const createError = require("http-errors");
require("dotenv").config();
const express = require("express");
const fileUpload = require("express-fileupload");
const path = require("path");
const cookieParser = require("cookie-parser");
const logger = require("morgan");
const bodyParser = require("body-parser");
const cron = require("node-cron");
const sqllConnection = require("./src/config/sqlConfig");
const flash = require("connect-flash");
const cors = require("cors");
// const limiter = require("./src/middlewares/rateLimiter");
const httpLogger = require("./src/middlewares/requestLogger");
const responseTimeLogger = require("./src/middlewares/responseTimeLogger");
const errorHandler = require("./src/middlewares/errorHandler");
const {
  metricsMiddleware,
  register,
} = require("./src/middlewares/prometheusMiddleware");

const app = express();
app.use(metricsMiddleware);

app.use(
  fileUpload({
    createParentPath: true,
  }),
);
app.use(cors({ credentials: true, origin: true }));
app.use(cookieParser());
app.set("views", path.join(__dirname, "views"));
app.engine("html", require("ejs").renderFile);
app.set("view engine", "html");
app.use("/site", express.static("static"));
sqllConnection.connectToSql();

app.use(logger("dev"));
app.use(express.json({ limit: "100mb" }));
app.use(bodyParser.urlencoded({ limit: "100mb", extended: true }));
app.use(bodyParser.json({ limit: "100mb" }));
app.use(express.static(path.join(__dirname, "public")));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));
app.use(httpLogger);
app.use(responseTimeLogger);
// app.use(limiter);

const SendEmail = require("./src/routes/Email");
const validations = require("./src/routes/validation");
const SQLSp = require("./src/routesSQL/storeProcedureSql");

app.use("/api/validations", validations); // api validations
app.use("/api/send", SendEmail);
//++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
// SQL Code Started

const SQlMenuRouter = require("./src/routesSQL/menuRoute");
const SQlFormRouter = require("./src/routesSQL/formRoute");
const SQlMasterRouter = require("./src/routesSQL/masterRoute");
const SQLDynamicRouterMiddleware = require("./src/routesSQL/sqlDynamicRouterMiddleware");
const SQlUserRouter = require("./src/routesSQL/userRoute");
const SQlReportRouter = require("./src/routesSQL/reportsRoute");
const spReports = require("./src/routesSQL/Reports&spRoute");
const spProfile = require("./src/routesSQL/profileRoute");
const SQLSendEmail = require("./src/routesSQL/Email");
const SQLUploadLogo = require("./src/routesSQL/uploadLogoRoute");
const SQLUserDashboard = require("./src/routesSQL/createDashboardRoute");
const SQLSpInvoice = require("./src/routesSQL/storeProcedureSql");
const SQLeInvoicing = require("./src/routesSQL/eInvoicingRoute");
const SQLAccountData = require("./src/routesSQL/accountingReports");
const SQLValidation = require("./src/routesSQL/validation");
const SQLSecurity = require("./src/routesSQL/securityRoute");
const activites = require("./src/routesSQL/activitesRoutes");
const SQLAllocation = require("./src/routesSQL/allocationRoutes");
const mergeBl = require("./src/routesSQL/mergeBlRoutes");
const operationalApi = require("./src/routesSQL/operationalApiRoutes");
const ssoLoginRoute = require("./src/routesSQL/ssoRoutes"); // by aakash yadav  a new sso route for by pass login for mobile app
// const extractInvoicePdfDataRoute = require("./src/routes/extractInvoicePdfDataRoute");
// const extractBlPdfDataRoute = require("./src/routes/extractBlPdfDataRoute");
// const extractForm32ASDataRoute = require("./src/routes/extractForm32ASDataRoute");
// const extractEnquireDataRoute = require("./src/routes/extractEnquireDataRoute");
const customerQuotationRoute = require("./src/routesSQL/customer-quotation.route");

const {
  deleteDeletedAttachments,
  deleteUnsavedAttachments,
} = require("./src/modelSQL/fileDelete");

app.post("/Sql/api/insertdata", SQLDynamicRouterMiddleware);
app.use("/Sql/api/menuControl", SQlMenuRouter);
app.use("/Sql/api/FormControl", SQlFormRouter);
app.use("/Sql/api/master", SQlMasterRouter);
app.use("/Sql/api/userControl", SQlUserRouter);
app.use("/Sql/api/fetch", SQlReportRouter);
app.use("/Sql/api/Reports", spReports);
app.use("/Sql/api/profile", spProfile);
app.use("/Sql/api/send", SQLSendEmail);
app.use("/Sql/api/uploadLogo", SQLUploadLogo);
app.use("/Sql/api/sp", SQLSp);
app.use("/Sql/api/userDashboard", SQLUserDashboard);
app.use("/Sql/api/spInvoice", SQLSpInvoice);
app.use("/Sql/api/eInvoicing", SQLeInvoicing);
app.use("/Sql/api/", SQLAccountData);
app.use("/Sql/api/", SQLValidation);
app.use("/Sql/api/security", SQLSecurity);
app.use("/Sql/api/activites", activites);
app.use("/Sql/api/fetch", SQLAllocation);
app.use("/Sql/api/create", mergeBl);
app.use("/Sql/api/v1", operationalApi);
app.use("/Sql/api/", ssoLoginRoute); // by aakash yadav  a new sso route for by pass login for mobile app
// app.use("/Sql/api/extract", extractInvoicePdfDataRoute);
// app.use("/Sql/api/ai/extract", extractBlPdfDataRoute);
// app.use("/Sql/api/ai/extract", extractForm32ASDataRoute);
// app.use("/Sql/api/ai", extractEnquireDataRoute);
app.use("/Sql/api/customer-quotation", customerQuotationRoute);

app.get("/api/metrics", async (req, res) => {
  res.setHeader("Content-Type", register.contentType);
  res.end(await register.metrics());
});

/*********************************************
 * Uncomment the following lines to enable the cron job for cleaning up attachments every 4 hours
 ********************************************/

cron.schedule("0 */4 * * *", async () => {
  console.log("🕒 Running bulk attachment cleanup job...");
  await deleteUnsavedAttachments();
  await deleteDeletedAttachments();
});

app.use(function (req, res, next) {
  next(createError(404));
});
// console.log("connection", connect);
// error handler
app.use(errorHandler);
const PORT = process.env.PORT || 3000;
console.log(`Server is running on port ${PORT}`.green);

module.exports = app;
