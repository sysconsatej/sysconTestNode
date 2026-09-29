const fs = require("fs");
const { executeQuery } = require("../modelSQL/model");

async function getFolderSize(folderPath, clientId) {
  const queryStatus = `select documentManagementSystem from  tblClientParameter where documentManagementSystem = 'N' and status = 1 and clientId = ${clientId}`;
  const responseStatus = await executeQuery(queryStatus, {});
  const statusAttach = responseStatus?.["recordset"];

  if (statusAttach?.length) {
    return {
      status: true,
      message: `You have no access to attach documents!`,
      success: false,
    };
  }

  let totalSize = 0;
  const query = `select attachmentSpace from  tblClientParameter where documentManagementSystem = 'Y' and status = 1 and clientId = ${clientId}`;
  const response = await executeQuery(query, {});
  const GB = response?.["recordset"]?.[0]?.attachmentSpace || 1;
  let totalGB = GB * 1024 * 1024 * 1024;

  function calculateSize(path) {
    const stats = fs.statSync(path);

    if (stats.isFile()) {
      totalSize += stats.size;
    } else if (stats.isDirectory()) {
      const dirContents = fs.readdirSync(path);
      dirContents.forEach((item) => {
        calculateSize(`${path}/${item}`);
      });
    }
  }

  calculateSize(folderPath);

  if (totalSize >= totalGB) {
    return {
      status: true,
      message: `Your storage capacity has surpassed the ${GB}GB limit. Kindly consider upgrading your plan.`,
      success: false,
    };
  }
}

module.exports = getFolderSize;
