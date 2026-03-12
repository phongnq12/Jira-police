const { getMentionTag } = require('../config/userMapping');
const env = require('../config/env');

const PLATFORM = env.ACTIVE_NOTIFICATION_PLATFORM;

/**
 * Persona Engine: "Jira Master"
 * Giọng văn: Nữ, ngọt ngào, nũng nịu, hài hước, hơi khiêu khích.
 * Nội dung: Ngắn gọn, đi thẳng vào vấn đề, không giáo điều.
 */
class MessageService {
    /**
     * Tạo link đến ticket trên Jira
     */
    getIssueLink(issueKey) {
        const baseUrl = env.JIRA.BASE_URL || 'https://your-company.atlassian.net';
        return `<a href="${baseUrl}/browse/${issueKey}">${issueKey}</a>`;
    }

    /**
     * [Kịch bản 1] Thiếu trường thông tin (Estimate, Due Date)
     */
    missingInformationAlert(issueKey, issueSummary, assigneeName, missingFields) {
        const assigneeTag = getMentionTag(assigneeName, PLATFORM);
        const issueLink = this.getIssueLink(issueKey);
        const fieldsText = missingFields.join(', ');

        return `
Anh ${assigneeTag} ơi~ ticket ${issueLink} - <i>${issueSummary}</i> đang <b>trống trơn ${fieldsText}</b> kìa 🫣

Anh mà không điền thì em biết báo cáo cho ai bây giờ? Vào Jira cập nhật giúp em nhé~ 💋
    `.trim();
    }

    /**
     * [Kịch bản 2] Ticket đến deadline (Due date = Today)
     */
    deadlineTodayAlert(issueKey, issueSummary, assigneeName, currentStatus) {
        const assigneeTag = getMentionTag(assigneeName, PLATFORM);
        const issueLink = this.getIssueLink(issueKey);

        return `
🚨 <b>DEADLINE HÔM NAY</b> 🚨

Anh ${assigneeTag} ơi~ ticket ${issueLink} - <i>${issueSummary}</i> hôm nay là hạn chót rồi mà trạng thái vẫn "<b>${currentStatus}</b>" nè 😳

Anh định để em chờ đến bao giờ? Cố lên anh nhé~ 💪✨
    `.trim();
    }

    /**
     * [Kịch bản 3] Log work vượt quá Original Estimation
     */
    overEstimateAlert(issueKey, issueSummary, assigneeName, originalEst, timeSpent) {
        const assigneeTag = getMentionTag(assigneeName, PLATFORM);
        const issueLink = this.getIssueLink(issueKey);

        return `
⚠️ <b>TRÀN ESTIMATION</b> ⚠️

Ối~ ${assigneeTag} ơi, ticket ${issueLink} - <i>${issueSummary}</i> anh làm lố giờ rồi kìa 😏
• Dự kiến: <b>${originalEst}</b>
• Thực tế: <b>${timeSpent}</b>

Anh "cày" nhiều vậy ai mà chịu nổi~ Báo PM review lại scope nhé! 💅
    `.trim();
    }

    /**
     * [Kịch bản 4] Task bị Blocked
     */
    blockedAlert(issueKey, issueSummary, assigneeName) {
        const assigneeTag = getMentionTag(assigneeName, PLATFORM);
        const issueLink = this.getIssueLink(issueKey);

        return `
🚨 <b>SOS! BLOCKED ALERT</b> 🚨

Ticket ${issueLink} - <i>${issueSummary}</i> của ${assigneeTag} đang bị <b>BLOCKED</b> rồi nè~

Ai rảnh vào cứu giùm đi, em thấy tội mà không giúp được 🥺💔
    `.trim();
    }

    /**
     * [Kịch bản 5] Dời Due Date không comment
     */
    silentDueDateChangeAlert(issueKey, issueSummary, assigneeName, oldDate, newDate) {
        const assigneeTag = getMentionTag(assigneeName, PLATFORM);
        const issueLink = this.getIssueLink(issueKey);

        return `
👀 <b>DỜI DEADLINE BÍ MẬT</b> 👀

Hmm~ ${assigneeTag} ơi~ em thấy anh lén dời deadline ticket ${issueLink} - <i>${issueSummary}</i> từ <b>${oldDate}</b> sang <b>${newDate}</b> mà không nói lý do nè...

Giấu em chuyện gì vậy? Comment giải thích đi anh~ 😘
    `.trim();
    }

    /**
     * [Kịch bản 6] Task quá hạn (Overdue)
     */
    overdueAlert(issueKey, issueSummary, assigneeName, daysOverdue) {
        const assigneeTag = getMentionTag(assigneeName, PLATFORM);
        const issueLink = this.getIssueLink(issueKey);

        return `
🔥 <b>QUÁ HẠN (OVERDUE)</b> 🔥

${assigneeTag} ơi~ ticket ${issueLink} - <i>${issueSummary}</i> quá hạn <b>${daysOverdue} ngày</b> rồi đó!

Anh bỏ rơi nó lâu vậy em buồn lắm á~ Xử lý giùm em đi nha 🥹
    `.trim();
    }

    /**
     * [Kịch bản 7] Quên Log Work khi Task đã chạy / hoàn thành
     */
    missingWorkLogAlert(issueKey, issueSummary, assigneeName, status) {
        const assigneeTag = getMentionTag(assigneeName, PLATFORM);
        const issueLink = this.getIssueLink(issueKey);

        return `
⏳ <b>QUÊN LOG WORK</b> ⏳

Anh ${assigneeTag} ơi~ ticket ${issueLink} - <i>${issueSummary}</i> đang "<b>${status}</b>" mà log work vẫn <b>0 giờ</b> á 🤔

Anh làm nhiều vậy sao không ghi lại? Em muốn biết anh đã cống hiến bao nhiêu mà~ ⏰💕
    `.trim();
    }
}

module.exports = new MessageService();
