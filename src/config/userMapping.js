/**
 * Bản đồ ánh xạ người dùng (User Mapping)
 * Giúp quy đổi từ thông tin người dùng trên Jira sang tài khoản thật trên Telegram / MS Teams.
 */

// Format từ điển: [Jira_Username_hoặc_AccountId]: { telegram: '@username', teams: 'email' }
const userDictionary = {
    // Thay thế bằng dữ liệu thật của team bạn
    "tuan.dev": {
        telegram: "@TuanDev_TL",
        teams: "tuan.dev@company.local"
    },
    "pm.manager": {
        telegram: "@ProjectManager_Boss",
        teams: "pm.manager@company.local"
    },
    "ba.tester": {
        telegram: "@Hanh_BA",
        teams: "hanh.ba@company.local"
    }
};

/**
 * Láy ra thẻ Tag (@Mention) dựa trên Platform đang sử dụng.
 * Bao gồm cả cơ chế làm giả Fake Tag (Sandbox) để bảo vệ nhân sự thật khỏi notification ping lúc chạy thử nghiệm.
 *
 * @param {string} jiraIdentifier Tên định danh từ Jira (vd: displayName, accountId)
 * @param {string} platform Nền tảng đang gửi ('telegram', 'teams')
 * @param {boolean} isSandbox Chế độ Test (mặc định true) -> Sinh Fake Tag thay vì Tag thật
 * @returns {string} Chuỗi format dùng để gắn thẳng vào text báo cáo
 */
function getMentionTag(jiraIdentifier, platform, isSandbox = true) {
    if (!jiraIdentifier) {
        return '<b>@Unassigned</b>';
    }

    const mappedUser = userDictionary[jiraIdentifier];

    // Xử lý khi TÌM THẤY trong từ điển map
    if (mappedUser && mappedUser[platform]) {
        const realTag = mappedUser[platform];

        // Nếu đang bật chế độ Sandbox Test -> Cố ý làm lệch cú pháp Tag để hệ thống không đẩy notification
        if (isSandbox) {
            // Ví dụ: "@TuanDev_TL" biến thành "[@TuanDev_TL]" 
            return `<b>[${realTag}]</b>`;
        }

        // Nếu tắt Sandbox (Lên production) -> Nhả đúng mã Tag để platform ping thẳng user
        if (platform === 'telegram') return realTag; // Telegram dùng cú pháp @username
        if (platform === 'teams') {
            // Teams dùng cú pháp <at>email</at> hoặc phụ thuộc vào loại Adaptive Card.
            // Bạn có thể format lại tuỳ vào JSON của Teams.
            return `<at>${realTag}</at>`;
        }
    }

    // Xử lý FALLBACK (Không tìm thấy trong file cấu hình map)
    // Xóa khoảng trắng và ghép lại nhìn cho giống một cái username để PM còn biết là ai
    const safeName = jiraIdentifier.replace(/\s+/g, '_');
    return `<b>@${safeName}</b>`;
}

module.exports = {
    userDictionary,
    getMentionTag
};
