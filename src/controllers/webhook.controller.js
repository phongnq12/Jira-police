const messageService = require('../services/message.service');
const notificationService = require('../services/notification.service');
const projectConfig = require('../config/projects');
const config = require('../config/env');

/**
 * Controller chuyên nhận và bóc tách Webhook từ Jira.
 */
async function handleJiraWebhook(req, res) {
    try {
        // === WEBHOOK AUTHENTICATION ===
        // Nếu đã cấu hình JIRA_WEBHOOK_SECRET, yêu cầu request phải gửi kèm header khớp
        const webhookSecret = config.JIRA.WEBHOOK_SECRET;
        if (webhookSecret) {
            const incomingSecret = req.headers['x-webhook-secret'];
            if (incomingSecret !== webhookSecret) {
                console.warn(`🚫 [Webhook] Từ chối request: Secret không khớp hoặc thiếu. IP: ${req.ip}`);
                return res.status(401).json({ error: 'Unauthorized: Invalid webhook secret' });
            }
        }

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
        const assigneeName = issue.fields.assignee ? (issue.fields.assignee.emailAddress || issue.fields.assignee.displayName) : null;
        
        // 2.5 Mapping Project Key --> Chat ID
        const taskProjectKey = issue.fields.project ? issue.fields.project.key : (issueKey.split('-')[0] || null);
        let targetChatId = null;
        
        // Truy ngược lại: Tìm xem Project này đang đấu với Group ID nào
        for (const [chatId, config] of Object.entries(projectConfig.projectRoutingMap)) {
            if (config.jiraProjectKey === taskProjectKey) {
                targetChatId = chatId;
                break;
            }
        }

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

                // 🔔 Kịch bản 1: Chuyển Status sang Blocked
                if (field === 'status' && toString.toLowerCase().includes('blocked')) {
                    const alertMsg = messageService.blockedAlert(issueKey, issueSummary, assigneeName);
                    await notificationService.dispatchAlert(`[Jira Master] 🛑 STATUS ALERT`, alertMsg, 'error', targetChatId);
                }

                // 🔔 Kịch bản 2: Đổi Due Date nhưng không xin phép (Không kèm comment lý do)
                if (field === 'duedate') {
                    if (!hasComment) {
                        const alertMsg = messageService.silentDueDateChangeAlert(issueKey, issueSummary, assigneeName, fromString, toString);
                        await notificationService.dispatchAlert(`[Jira Master] 👀 DUE DATE CHANGED`, alertMsg, 'warning', targetChatId);
                    }
                }

                // 🔔 Kịch bản 7: Kéo Done rụp phát nhưng quên Log Work
                if (field === 'status') {
                    const doneStatuses = ['done', 'resolved', 'closed'];
                    if (doneStatuses.includes(toString.toLowerCase())) {
                        const timeSpent = issue.fields.timespent || 0;
                        
                        // Danh sách vé cha được miễn trừ bắt buộc Log Work khi kéo Done
                        // Epic luôn miễn trừ. Story/Task chỉ miễn trừ khi CÓ sub-task bên trong.
                        const issueTypeName = issue.fields.issuetype ? issue.fields.issuetype.name.toLowerCase() : '';
                        const hasSubtasks = issue.fields.subtasks && issue.fields.subtasks.length > 0;
                        const isExempt = issueTypeName === 'epic' || 
                            (['story', 'user story', 'task'].includes(issueTypeName) && hasSubtasks);

                        if (timeSpent === 0 && !isExempt) {
                            const alertMsg = messageService.missingWorkLogAlert(issueKey, issueSummary, assigneeName, toString);
                            await notificationService.dispatchAlert(`[Jira Master] ⏳ QUÊN LOG WORK`, alertMsg, 'warning', targetChatId);
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
