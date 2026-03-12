const messageService = require('../services/message.service');
const notificationService = require('../services/notification.service');

/**
 * Controller chuyên nhận và bóc tách Webhook từ Jira.
 */
async function handleJiraWebhook(req, res) {
    try {
        const payload = req.body;

        // Trả về HTTP 200 ngay lập tức để Jira không bị Timeout và không Retry nã đạn liên tục
        res.status(200).send('OK');

        // 1. Phân loại sự kiện
        const webhookEvent = payload.webhookEvent;
        if (webhookEvent !== 'jira:issue_updated' && webhookEvent !== 'jira:issue_created') {
            return; // Chỉ quan tâm lúc tạo và lúc cập nhật task
        }

        const issue = payload.issue;
        if (!issue || !issue.fields) return;

        // 2. Lấy thông tin cơ bản của Task
        const issueKey = issue.key;
        const issueSummary = issue.fields.summary;
        const assigneeName = issue.fields.assignee ? issue.fields.assignee.displayName : null;

        // 3. Xử lý Logic dò Changelog (Bắt quả tang thay đổi)
        if (webhookEvent === 'jira:issue_updated' && payload.changelog && payload.changelog.items) {
            const changes = payload.changelog.items;

            // Kiểm tra xem lần update này có đi kèm text comment của người dùng hay không
            const hasComment = payload.comment && payload.comment.body && payload.comment.body.trim().length > 0;

            for (const item of changes) {
                const field = item.field;
                // Bóc dữ liệu Before & After
                const fromString = item.fromString || 'Trống';
                const toString = item.toString || 'Trống';

                // 🔔 Scenario 4: Chuyển Status sang Blocked
                if (field === 'status' && toString.toLowerCase().includes('blocked')) {
                    const alertMsg = messageService.blockedAlert(issueKey, issueSummary, assigneeName);
                    await notificationService.dispatchAlert(`[Jira Master] 🛑 STATUS ALERT`, alertMsg, 'error');
                }

                // 🔔 Scenario 5: Đổi Due Date nhưng không xin phép (Không kèm comment lý do)
                if (field === 'duedate') {
                    if (!hasComment) { // Đây mẹo logic cực hay của Jira Master
                        const alertMsg = messageService.silentDueDateChangeAlert(issueKey, issueSummary, assigneeName, fromString, toString);
                        await notificationService.dispatchAlert(`[Jira Master] 👀 DUE DATE CHANGED`, alertMsg, 'warning');
                    }
                }

                // 🔔 Scenario 7: Kéo Done rụp phát nhưng quên Log Work
                if (field === 'status') {
                    const doneStatuses = ['done', 'resolved', 'closed'];
                    if (doneStatuses.includes(toString.toLowerCase())) {
                        const timeSpent = issue.fields.timespent || 0;
                        if (timeSpent === 0) {
                            const alertMsg = messageService.missingWorkLogAlert(issueKey, issueSummary, assigneeName, toString);
                            await notificationService.dispatchAlert(`[Jira Master] ⏳ QUÊN LOG WORK`, alertMsg, 'warning');
                        }
                    }
                }
            }
        }

    } catch (error) {
        console.error('❌ Lỗi Controller khi xử lý Jira Webhook:', error.message);
    }
}

module.exports = {
    handleJiraWebhook
};
