/**
 * Bản đồ ánh xạ người dùng (User Mapping)
 * Giúp quy đổi từ email (hoặc tên hiển thị/accountId) trên Jira sang tài khoản thật trên Telegram / MS Teams.
 */

// Format từ điển: [Jira_Email_hoặc_DisplayName]: { telegram: '@username', teams: 'email' }
const userDictionary = {
    // Thay thế bằng email cty thật của team bạn
    "tuyenbq@synodus.com": {
        telegram: "@hyo_caspian",
        teams: "tuyenbq@synodus.com"
    },
    "nguyetdt@aequitas.vn": {
        telegram: "@nguyetdt1988",
        teams: "nguyetdt@aequitas.vn"
    },
    "hiepnn@synodus.com": {
        telegram: "@hiepnn30",
        teams: "hiepnn@synodus.com"
    },
    "luunv@synodus.com": {
        telegram: "@hwunguyen",
        teams: "luunv@synodus.com"
    },
    "longpt@synodus.com": {
        telegram: "@TrentPham9102",
        teams: "longpt@synodus.com"
    },
    "binhpt@synodus.com": {
        telegram: "@binhpt689",
        teams: "binhpt@synodus.com"
    },
    "lamtt@synodus.com": {
        telegram: "@itslamtran",
        teams: "lamtt@synodus.com"
    },
    "phongnq@aequitas.com": {
        telegram: "@phong123107",
        teams: "phongnq@aequitas.com"
    },
    "trangntt1@aequitas.vn": {
        telegram: "@thu_trang_277",
        teams: "trangntt1@aequitas.vn"
    },
};

/**
 * Láy ra thẻ Tag (@Mention) dựa trên Platform đang sử dụng.
 * Bao gồm cả cơ chế làm giả Fake Tag (Sandbox) để bảo vệ nhân sự thật khỏi notification ping lúc chạy thử nghiệm.
 *
 * @param {string} jiraIdentifier Tên định danh từ Jira (vd: emailAddress, displayName, accountId)
 * @param {string} platform Nền tảng đang gửi ('telegram', 'teams')
 * @param {boolean} isSandbox Chế độ Test (mặc định false để test thật) -> Sinh Fake Tag thay vì Tag thật
 * @returns {string} Chuỗi format dùng để gắn thẳng vào text báo cáo
 */
function getMentionTag(jiraIdentifier, platform, isSandbox = false) {
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
