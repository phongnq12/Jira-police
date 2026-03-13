const { CronJob } = require('cron');
const jiraService = require('../services/jira.service');
const messageService = require('../services/message.service');
const notificationService = require('../services/notification.service');
const env = require('../config/env');

const PROJECT_KEY = env.JIRA.PROJECT_KEY;

/**
 * Hàm hỗ trợ tạm dừng (sleep) để tránh bị Rate Limit 429
 */
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Quét toàn bộ các task đang mở và kiểm tra các điều kiện cảnh báo.
 */
async function runDailyReport(isScanAll = false) {
    console.log(`[Cronjob] Bắt đầu chạy luồng quét Scheduled Report... (Scan All: ${isScanAll})`);
    try {
        // Tìm tất cả các task chưa hoàn thành (Unresolved) trong dự án
        let jql = `project = "${PROJECT_KEY}" AND resolution = Unresolved`;
        if (!isScanAll) {
            jql += ` AND sprint IN openSprints()`;
        }

        // Yêu cầu Jira API trả về các trường cần thiết để phân tích
        const data = await jiraService.searchIssues(jql, [
            'summary', 'status', 'assignee', 'duedate', 'timeoriginalestimate', 'timespent', 'issuetype'
        ]);

        if (!data.issues || data.issues.length === 0) {
            console.log('[Cronjob] Dự án hiện tại không có task nào đang mở/nợ.');
            return;
        }

        // Lấy thời điểm hôm nay (reset giờ về 0 để so sánh ranh giới ngày)
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        let overdueCount = 0;
        let deadlineTodayCount = 0;
        let overEstimateCount = 0;
        let missingInfoCount = 0;

        let trackingWorklogCount = 0;

        for (const issue of data.issues) {
            const key = issue.key;
            const fields = issue.fields;

            const summary = fields.summary;
            const status = fields.status ? fields.status.name : 'Unknown';
            const assigneeName = fields.assignee ? fields.assignee.displayName : null;
            const issueTypeName = fields.issuetype ? fields.issuetype.name : 'Unknown';

            // --- KIỂM TRA MỤC 1 & 2 & 7: THIẾU THÔNG TIN & TRÀN ESTIMATE & THIẾU LOG WORK --- //
            const initStatuses = ['to do', 'open'];
            const isInitStatus = initStatuses.includes(status.toLowerCase());
            const isBugLike = issueTypeName.toLowerCase().includes('bug');

            const missingFields = [];
            
            // Due date: Bỏ qua kiểm tra nếu đang ở trạng thái To do/Open (áp dụng MỌI LOẠI ticket)
            if (!fields.duedate && !isInitStatus) {
                missingFields.push('Due Date');
            }

            // Estimate: Bỏ qua kiểm tra nếu đang ở To do/Open NHƯNG CHỈ áp dụng cho vé Bug/Sub-bug
            if (!fields.timeoriginalestimate && fields.timeoriginalestimate !== 0) {
                if (!(isInitStatus && isBugLike)) {
                    missingFields.push('Original Estimate');
                }
            }

            // [Kịch bản 1]: Báo động nếu task vứt trống thông tin Planning
            // Mặc định luôn bỏ qua các task đã đóng/hủy (Cancelled, Done, Resolved, Closed)
            const deadStatuses = ['cancelled', 'done', 'resolved', 'closed'];
            const isIgnored = deadStatuses.includes(status.toLowerCase());

            if (missingFields.length > 0 && !isIgnored) {
                missingInfoCount++;
                console.log(`[Cronjob] Task ${key} thiếu thông tin: ${missingFields.join(', ')}. Tiến hành cảnh báo...`);
                const missingMsg = messageService.missingInformationAlert(key, summary, assigneeName, missingFields);
                await notificationService.dispatchAlert(`[Jira Master] 📝 THIẾU THÔNG TIN PLANNING`, missingMsg, 'info');
                await sleep(1000); // Tạm nghỉ 1s để tránh Telegram Rate Limit
            }

            // [Kịch bản 7]: Task đang chạy thực tế nhưng Time Spent đang là 0
            if (status.toLowerCase().includes('in progress') || status.toLowerCase().includes('doing')) {
                const timeSpent = fields.timespent || 0;
                if (timeSpent === 0) {
                    trackingWorklogCount++;
                    const alertMsg = messageService.missingWorkLogAlert(key, summary, assigneeName, status);
                    await notificationService.dispatchAlert(`[Jira Master] ⏳ QUÊN LOG WORK`, alertMsg, 'warning');
                    await sleep(1000); // Tạm nghỉ 1s
                }
            }

            // [Kịch bản 3]: Kiểm tra xem số giờ Log Work có vượt mức Estimate gốc ban đầu chưa
            if (fields.timeoriginalestimate && fields.timespent) {
                if (fields.timespent > fields.timeoriginalestimate) { // Cùng đơn vị là Seconds (Giây)
                    overEstimateCount++;
                    // Quy đổi giây sang giờ cho PM dễ đọc (VD: 3600s -> 1h)
                    const origHours = (fields.timeoriginalestimate / 3600).toFixed(1) + 'h';
                    const spentHours = (fields.timespent / 3600).toFixed(1) + 'h';

                    const overMsg = messageService.overEstimateAlert(key, summary, assigneeName, origHours, spentHours);
                    await notificationService.dispatchAlert(`[Jira Master] ⚠️ VƯỢT ESTIMATE`, overMsg, 'warning');
                    await sleep(1000); // Tạm nghỉ 1s
                }
            }

            // --- KIỂM TRA MỤC 3 & 4: DEADLINE VÀ QUÁ HẠN --- //
            if (fields.duedate) {
                const dueDate = new Date(fields.duedate);
                dueDate.setHours(0, 0, 0, 0);

                const diffTime = today - dueDate;
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); // Số ngày chênh lệch

                if (diffDays > 0) {
                    overdueCount++;
                    // [Kịch bản 6]: Đã quá hạn (Overdue)
                    const overdueMsg = messageService.overdueAlert(key, summary, assigneeName, diffDays);
                    await notificationService.dispatchAlert(`[Jira Master] 🔥 TASK QUÁ HẠN`, overdueMsg, 'error');
                    await sleep(1000); // Tạm nghỉ 1s
                } else if (diffDays === 0) {
                    deadlineTodayCount++;
                    // [Kịch bản 2]: Đúng ngày hôm nay là Deadline (Due date = Today)
                    const deadlineMsg = messageService.deadlineTodayAlert(key, summary, assigneeName, status);
                    await notificationService.dispatchAlert(`[Jira Master] 🚨 DEADLINE HÔM NAY`, deadlineMsg, 'warning');
                    await sleep(1000); // Tạm nghỉ 1s
                }
            }
        }

        console.log(`\n[Cronjob] Phân tích hoàn tất ${data.issues.length} tasks chưa giải quyết.`);
        console.log(`  📊 Thống kê rủi ro:`);
        console.log(`  - ⚠️ Tràn Estimate: ${overEstimateCount}`);
        console.log(`  - 🚨 Hạn chót hôm nay: ${deadlineTodayCount}`);
        console.log(`  - 🔥 Quá hạn (Overdue): ${overdueCount}`);
        console.log(`  - 📝 Kịch bản Dư Thông Tin: ${missingInfoCount}`);
        console.log(`  - ⏳ Kịch bản Tàng Hình Log Work: ${trackingWorklogCount}`);

        if ((overEstimateCount + deadlineTodayCount + overdueCount + missingInfoCount + trackingWorklogCount) === 0) {
            console.log(`  => ✅ KHÔNG CÓ CẢNH BÁO NÀO TỪ MỤC CHÍNH. Gửi thông báo khích lệ (All Clear).\n`);
            
            const allClearMsg = messageService.allClearAlert();
            await notificationService.dispatchAlert(`[Jira Master] 🌟 BẦU TRỜI TRONG XANH`, allClearMsg, 'info');
        } else {
            console.log(`  => 📡 Đã phát lệnh nã Notification.\n`);
        }

    } catch (error) {
        console.error('[Cronjob] Lỗi khi chạy job:', error.message);
    }
}



/**
 * Khởi tạo bộ đếm thời gian
 */
function initCronJobs() {
    console.log('⏳ Đang khởi tạo các luồng Cronjob...');

    let schedule = env.CRON_SCHEDULE || '0 * * * *';
    
    // Loại bỏ dấu ngoặc kép/đơn thừa (lỗi phổ biến khi nhập ENV trên hosting dashboard)
    schedule = schedule.replace(/['"]/g, '').trim();
    
    // Thư viện 'cron' dùng 6 trường (giây phút giờ ngày tháng thứ)
    // Nếu user đang dùng 5 trường (node-cron style), tự động thêm '0' (giây) ở đầu
    const fields = schedule.split(/\s+/);
    if (fields.length === 5) {
        schedule = `0 ${schedule}`;
    }
    console.log(`📅 Lịch Cron sẽ chạy: ${schedule}`);
    
    try {
        const job = new CronJob(
            schedule, 
            async () => {
                console.log(`[Cronjob] Đang thực thi task theo lịch: ${schedule}`);
                await runDailyReport();
            },
            null, // onComplete
            true, // start
            'Asia/Ho_Chi_Minh' // timezone
        );
        console.log(`✅ Đã đặt lịch quét thành công! Lịch: ${schedule} (Timezone: Asia/Ho_Chi_Minh)`);
    } catch (err) {
        console.error('❌ Lỗi khởi tạo Cron:', err.message);
    }
}

module.exports = {
    initCronJobs,
    runDailyReport
};
