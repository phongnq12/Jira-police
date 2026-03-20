/**
 * Utility: Sanitize input trước khi gom vào JQL query
 * Chống JQL Injection — loại bỏ ký tự đặc biệt nguy hiểm
 */

/**
 * Sanitize chuỗi text (ví dụ: tên assignee) trước khi gom vào JQL
 * Loại bỏ: dấu ngoặc kép, backslash, và các ký tự JQL operator
 */
function sanitizeJqlString(input) {
    if (!input || typeof input !== 'string') return '';
    return input
        .replace(/["\\]/g, '')        // Loại bỏ dấu ngoặc kép và backslash
        .replace(/[{}()\[\]]/g, '')   // Loại bỏ dấu ngoặc
        .replace(/[;|&]/g, '')        // Loại bỏ pipe, semicolon
        .trim();
}

/**
 * Validate sprint ID — chỉ chấp nhận số nguyên dương
 * @returns {number|null} Sprint ID hợp lệ hoặc null
 */
function sanitizeSprintId(input) {
    if (!input) return null;
    const trimmed = String(input).trim();
    // Chỉ chấp nhận chuỗi thuần số (không có ký tự lạ phía sau)
    if (!/^\d+$/.test(trimmed)) return null;
    const parsed = parseInt(trimmed, 10);
    if (parsed <= 0) return null;
    return parsed;
}

module.exports = {
    sanitizeJqlString,
    sanitizeSprintId
};
