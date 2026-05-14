/**
 * Bản đồ Định tuyến Dự án (Project Routing Map)
 * Mục đích: Mapping giữa ID của Group Telegram và Tên/Key của thư mục Jira tương ứng.
 * Thiết kế cho hệ thống chạy 1 Server (1 Instance) có khả năng phục vụ nhiều dự án.
 */
const env = require('./env');

const projectRoutingMap = {
    // ===== NHÓM TEST (cronEnabled: false → Cronjob KHÔNG gửi cảnh báo, chỉ dùng lệnh thủ công) =====
    // Dự án Từ điển dữ liệu - Test
    "-5185115610": {
        jiraProjectKey: "V.25.G.RD.C12.43.S",
        projectName: "Từ điển dữ liệu (Test)",
        cronEnabled: false
    },
    // Dự án Xếp hạng CSDL - Test
    "-5039880714": {
        jiraProjectKey: "V.25.G.RD.C12.43.2.S",
        projectName: "Xếp hạng CSDL (Test)",
        cronEnabled: false
    },
    // Dự án Cơ sở cai nghiện - Test
    "-5124706179": {
        jiraProjectKey: "V.26.G.FX.103.66.S",
        projectName: "Cơ sở cai nghiện",
        cronEnabled: false
    },

    // ===== NHÓM LIVE (cronEnabled: true → Cronjob gửi cảnh báo tự động) =====
    // Dự án Từ điển dữ liệu - Live
    "-1003852624760": {
        jiraProjectKey: "V.25.G.RD.C12.43.S",
        projectName: "Từ điển dữ liệu",
        cronEnabled: true
    },
    // Dự án Xếp hạng CSDL - Live
    "-1003711810972": {
        jiraProjectKey: "V.25.G.RD.C12.43.2.S",
        projectName: "Xếp hạng CSDL",
        cronEnabled: true
    }
};

// TỰ ĐỘNG MERGE cấu hình biến môi trường (.env / Render) vào hệ thống
// Đảm bảo không làm vỡ các setup cũ trên hosting
if (env.TELEGRAM.TEST_GROUP_ID && env.JIRA.PROJECT_KEY) {
    const defaultChatId = String(env.TELEGRAM.TEST_GROUP_ID);

    // Chỉ thêm vào nếu mảng config tĩnh (ở trên) chưa khai báo ID group này
    if (!projectRoutingMap[defaultChatId]) {
        projectRoutingMap[defaultChatId] = {
            jiraProjectKey: env.JIRA.PROJECT_KEY,
            projectName: "Dự Án Mặc Định (Từ ENV)"
        };
        console.log(`[Config] 🔌 Đã tự động tải cấu hình Render Env cho Dự án: ${env.JIRA.PROJECT_KEY}`);
    }
}

/**
 * Hàm hỗ trợ lấy Jira Project Key tùy theo Group ID người dùng đang Chat.
 * Cực kỳ quan trọng để con Bot không bị nhầm lẫn dữ liệu giữa các luồng.
 * 
 * @param {string} chatId ID của Group người dùng gõ lệnh
 * @param {string} defaultProjectKey (Tùy chọn) Project dự phòng nếu không tìm thấy mapping
 * @returns {string} Mã dự án trên Jira (VD: X25RDDIGILEND)
 */
function getProjectKeyByChatId(chatId, defaultProjectKey = null) {
    const routing = projectRoutingMap[chatId];
    if (routing && routing.jiraProjectKey) {
        return routing.jiraProjectKey;
    }
    // Nếu không tìm thấy, fallback về dự án mặc định trong file .env để không sập các tính năng cũ
    return defaultProjectKey;
}

/**
 * Dành cho Cronjob: Trả về danh sách tất cả các Config đang có để Cron chạy vòng lặp
 * @returns {Array} Mảng các object chứa chatId và jiraProjectKey
 */
/**
 * Trả về danh sách các project đang hoạt động
 * @param {boolean} cronOnly Nếu true, chỉ trả về nhóm có cronEnabled=true (dùng cho Cronjob)
 */
function getAllActiveProjects(cronOnly = false) {
    const projects = [];
    for (const [chatId, config] of Object.entries(projectRoutingMap)) {
        if (cronOnly && config.cronEnabled === false) continue;
        projects.push({
            chatId: chatId,
            jiraProjectKey: config.jiraProjectKey,
            projectName: config.projectName
        });
    }
    return projects;
}

module.exports = {
    projectRoutingMap,
    getProjectKeyByChatId,
    getAllActiveProjects
};
