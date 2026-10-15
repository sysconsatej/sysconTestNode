const validate = require("../helper/validate");
const { executeQuery, executeStoredProcedure } = require("../modelSQL/model");

module.exports = {
  getMenuList: async (req, res) => {
    try {
      const { companyId, companyBranchId, userId, clientId } = req.body;
      const query = `menuRetrievalApi`;
      const parameters = {
        companyId,
        companyBranchId,
        userId: req.userId,
        clientId: req.clientId,
      };
      let data = await executeStoredProcedure(query, parameters);

      if (data) {
        res.send({
          success: true,
          message: "Data Fetched Successfully",
          data: data,
        });
      } else {
        res.send({
          success: false,
          message: "No Data Found",
          data: [],
        });
      }
    } catch (error) {
      res.status(500).send({
        success: false,
        message: "Error - " + error.message,
        data: error.message,
      });
    }
  },
  menuAccessSubmit: async (req, res) => {
    try {
      const { userId, menu_json, updatedBy, companyId, companyBranchId } = req.body;

      if (!userId || !menu_json || !updatedBy) {
        return res.status(400).json({
          success: false,
          message: "userId, updatedBy or menu_json is messing!",
        });
      }

      const query = `menuAccessApi`;
      const parameters = {
        userId,
        menu_json,
        updatedBy,
        companyId,
        companyBranchId,
      };
      let data = await executeStoredProcedure(query, parameters);
      if (data) {
        res.status(200).json({
          message: "Menu updated successfully!",
          data: data,
          success: true,
        });
      } else {
        res.status(500).json({
          message: "Data not found!",
          data: data,
          success: false,
        });
      }
    } catch (error) {
      res.status(500).send({
        success: false,
        message: "Error - " + error.message,
        data: error.message,
      });
    }
  },
  getMenuById: async (req, res) => {
    try {
      const menuId = Number(req.body?.menuId);

      if (!Number.isInteger(menuId) || menuId <= 0) {
        return res.status(400).json({
          success: false,
          message: "A valid menuId is required",
          data: null,
        });
      }

      const query = `
      ;WITH MenuHierarchy AS
      (
          SELECT
              id,
              menuName,
              parentMenuId,
              CAST(menuName AS VARCHAR(MAX)) AS MenuPath,
              0 AS Level
          FROM tblMenu
          WHERE id = ${menuId}

          UNION ALL

          SELECT
              p.id,
              p.menuName,
              p.parentMenuId,
              CAST(p.menuName + ', ' + mh.MenuPath AS VARCHAR(MAX)),
              mh.Level + 1
          FROM tblMenu p
          INNER JOIN MenuHierarchy mh
              ON p.id = mh.parentMenuId
      )
      SELECT TOP 1
          MenuPath
      FROM MenuHierarchy
      ORDER BY Level DESC
      OPTION (MAXRECURSION 100);
    `;


      const result = await executeQuery(query, {});
      if (!result || result.length === 0) {
        return res.status(404).json({
          success: false,
          message: "Menu not found",
          data: null,
        });
      }

      return res.status(200).json({
        success: true,
        message: "Data fetched successfully",
        data: result.recordset[0].MenuPath,
      });

    } catch (error) {
      res.status(500).send({
        success: false,
        message: "Error - " + error.message,
        data: error.message,
      });
    }
  },
};
