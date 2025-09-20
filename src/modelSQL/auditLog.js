import { executeStoredProcedure } from "./model";

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

export default async function auditLog({ data, formId, id, clientID }) {
    let query = {
        clientID: clientID || 4,
        menuID: formId,
        recordID: id,
    };
    let data = await executeStoredProcedure("dynamicFetchApi", query);
    data.length > 0
    let updated = data[0];
    const changes = detectChanges(data, updated);
    return changes;
}