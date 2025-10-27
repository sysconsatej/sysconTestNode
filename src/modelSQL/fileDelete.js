const {
    executeQuery,
    executeStoredProcedure,
    executeNonJSONStoredProcedure,
} = require("../modelSQL/model");
const fs = require("fs");
async function deleteUnsavedAttachments() {

    try {
        // Step 1: Get all files marked as deleted
        const result = await executeQuery(`
SELECT 
    t.id,
    CONCAT('./public/', t.path) AS path
FROM dbo.tblAttachmentTrack AS t
WHERE 
    t.isDeleted = 0
    AND NOT EXISTS (
        SELECT 1
        FROM dbo.tblAttachement AS a
        WHERE a.path = t.path
          AND a.status = 1
    );
    `, {});

        const files = result.recordset;
        if (!files.length) {
            console.log('✅ No deleted attachments found.');
            return;
        }

        console.log(`🗑️ Found ${files.length} files to delete.`);

        // Step 2: Delete files in bulk
        const deletedIds = [];
        await Promise.all(
            files.map(async (file) => {
                const filePath = file.path;

                try {
                    if (fs.existsSync(filePath)) {
                        fs.unlinkSync(filePath);
                        console.log(`✅ Deleted file: ${file.path}`);
                    } else {
                        console.log(`⚠️ File not found: ${file.path}`);
                    }
                    deletedIds.push(file.id);
                } catch (err) {
                    console.error(`❌ Error deleting file: ${file.path}`, err.message);
                }
            })
        );

        // Step 3: Bulk delete database records
        if (deletedIds.length > 0) {
            const idList = deletedIds.join(',');
            await executeQuery(`
        DELETE FROM dbo.tblAttachmentTrack WHERE id IN (${idList})
      ` , {});
            console.log(`🧹 Deleted ${deletedIds.length} DB records.`);
        }

        console.log('✅ Bulk cleanup complete.');
    } catch (err) {
        console.error('❌ Error in bulk deletion:', err);
    }
}

async function deleteDeletedAttachments() {

    try {
        // Step 1: Get all files marked as deleted
        const result = await executeQuery(`
      SELECT id, CONCAT('./public/',[path]) as path from tblAttachement where status =0
    `, {});

        const files = result.recordset;
        if (!files.length) {
            console.log('✅ No deleted attachments found.');
            return;
        }

        console.log(`🗑️ Found ${files.length} files to delete.`);

        // Step 2: Delete files in bulk
        const deletedIds = [];
        await Promise.all(
            files.map(async (file) => {
                const filePath = file.path;

                try {
                    if (fs.existsSync(filePath)) {
                        fs.unlinkSync(filePath);
                        console.log(`✅ Deleted file: ${file.path}`);
                        deletedIds.push(file.id);
                    } else {
                        console.log(`⚠️ File not found: ${file.path}`);
                    }
                   
                } catch (err) {
                    console.error(`❌ Error deleting file: ${file.path}`, err.message);
                }
            })
        );

        // Step 3: Bulk delete database records
        if (deletedIds.length > 0) {
            const idList = deletedIds.join(',');
            await executeQuery(`
        DELETE FROM tblAttachement WHERE id IN (${idList}) and status=0
      ` , {});
            console.log(`🧹 Deleted ${deletedIds.length} DB records.`);
        }

        console.log('✅ Bulk cleanup complete.');
    } catch (err) {
        console.error('❌ Error in bulk deletion:', err);
    }
}

module.exports = { deleteDeletedAttachments, deleteUnsavedAttachments };  
