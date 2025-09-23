const { executeStoredProcedure } = require("./model");

const detectChanges = (original, updated) => {
    let changes = {};
    Object.keys(updated).forEach(key => {
        if (!original.hasOwnProperty(key) || original[key] !== updated[key]) {
            if (typeof updated[key] === 'object' && updated[key] !== null) {
                const subChanges = detectChanges(original[key] || {}, updated[key]);
                if (Object.keys(subChanges).length > 0) {
                    changes[key] = subChanges;
                }
            } else {
                changes[key] = updated[key];
            }
        }
    });

    // Check if 'tableName' has changed
    if (original.tableName !== updated.tableName) {
        changes.tableName = {

            tableName: updated.tableName,
        };
    }

    return changes;
};

exports.auditLog = async function auditLog({ data, formId, id, clientID }) {
    let query = {
        clientID: clientID || 4,
        menuID: formId,
        recordID: id,
    };
    let res = await executeStoredProcedure("dynamicFetchApi", query);
    res.length > 0
    let updated = res[0] || {};
    const changes = detectChanges(updated, data);
    return {
        prevFields: updated,
        changes
    };

}