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
Anh/Chị Anh/Chị ${assigneeTag} ơi~ ticket ${issueLink} - <i>${issueSummary}</i> đang <b>trống trơn ${fieldsText}</b> kìa 🫣

Anh/chị mà không điền thì em biết báo cáo cho ai bây giờ? Vào Jira cập nhật giúp em nhé~ 💋
    `.trim();
    }

    /**
     * [Kịch bản 2] Ticket đến deadline (Due date = Today)
     */
    deadlineTodayAlert(issueKey, issueSummary, assigneeName, currentStatus) {
        const assigneeTag = getMentionTag(assigneeName, PLATFORM);
        const issueLink = this.getIssueLink(issueKey);

        return `
🔔 <b>NHẮC NHẸ DEADLINE HÔM NAY</b> 🔔

Anh/Chị ${assigneeTag} ơi, ticket ${issueLink} - <i>${issueSummary}</i> hôm nay đã đến hạn công việc rồi nhé! ✨

Cuối ngày anh/chị nhớ dành chút thời gian cập nhật trạng thái và log work đầy đủ giúp em nha~ Cố lên anh/chị! 💪💕
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

Ối~ ${assigneeTag} ơi, ticket ${issueLink} - <i>${issueSummary}</i> anh/chị làm lố giờ rồi kìa 😏
• Dự kiến: <b>${originalEst}</b>
• Thực tế: <b>${timeSpent}</b>

Anh/chị "cày" nhiều vậy ai mà chịu nổi~ Báo PM review lại scope nhé! 💅
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

Hmm~ ${assigneeTag} ơi~ em thấy anh/chị lén dời deadline ticket ${issueLink} - <i>${issueSummary}</i> từ <b>${oldDate}</b> sang <b>${newDate}</b> mà không nói lý do nè...

Giấu em chuyện gì vậy? Comment giải thích đi anh/chị~ 😘
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

Anh/Chị ${assigneeTag} ơi~ ticket ${issueLink} - <i>${issueSummary}</i> quá hạn <b>${daysOverdue} ngày</b> rồi đó!

Anh/chị bỏ rơi nó lâu vậy em buồn lắm á~ Xử lý giùm em đi nha 🥹
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

Anh/Chị ${assigneeTag} ơi~ ticket ${issueLink} - <i>${issueSummary}</i> đang "<b>${status}</b>" mà log work vẫn <b>0 giờ</b> á 🤔

Anh/chị làm nhiều vậy sao không ghi lại? Em muốn biết anh/chị đã cống hiến bao nhiêu mà~ ⏰💕
    `.trim();
    }

    /**
     * [Kịch bản 8] Bầu Trời Trong Xanh (Khích lệ tinh thần)
     */
    allClearAlert() {
        const messages = [
            "Hôm nay team ngoan quá, xứng đáng 10 điểm không có nhưng! 🚀",
            "Không một tiếng còi báo động nào, Em xin phép đi ngủ giữ sắc đẹp! 💅",
            "Cả làng bình yên, các dev nhà mình nỗ lực tuyệt vời quá, mlem mlem! 🍗",
            "Quét mỏi cả mắt mà chẳng thấy ai vi phạm, chán ghê! Giỡn thôi, anh em làm tốt lắm 💕",
            "Bầu trời trong xanh, Jira sạch sẽ. Hôm nay mọi người xuất sắc quá đi~ ✨",
            "Lịch trình sạch bong kin kít! Ai cũng ngoan thế này thì làm em thất nghiệp mất thôi 🥺",
            "Một ngày không có cảnh báo! Các anh hùng Agile của em nay chăm chỉ quá chừng 🎊"
        ];

        // Lấy ngẫu nhiên (random) một câu khen
        const randomIndex = Math.floor(Math.random() * messages.length);
        const randomMsg = messages[randomIndex];

        return `
🌟 <b>BẦU TRỜI TRONG XANH - ALL CLEAR</b> 🌟

${randomMsg}

Tiếp tục phát huy nhé cả nhà! Yêu thương~ 💖
    `.trim();
    }

    /**
     * [Kịch bản 9] Không có Task nào đang thực hiện (Chỉ có To Do/Open/Reopen)
     */
    noActiveTaskAlert(assigneeName, issueKeys) {
        const assigneeTag = getMentionTag(assigneeName, PLATFORM);
        const keysText = issueKeys.join(', ');

        return `
🚀 <b>BẮT ĐẦU CÔNG VIỆC THÔI ANH ƠI!</b> 🚀

Anh/Chị ${assigneeTag} ơi~ Em thấy anh/chị đang có các ticket (${keysText}) vẫn đang nằm im ở trạng thái chờ (To Do/Open) nè...

Anh/chị nổ máy chọn 1 cái để chuyển sang <b>In Progress</b>, rồi tiện tay set <b>Due Date</b> và <b>Log Work</b> cho em vui nhé! 💋✨
    `.trim();
    }

    /**
     * [Kịch bản 10] Due date nằm ngoài thời gian của Sprint
     */
    outOfSprintBoundsAlert(issueKey, issueSummary, assigneeName, sprintName, dueDate, reason) {
        const assigneeTag = getMentionTag(assigneeName, PLATFORM);
        const issueLink = this.getIssueLink(issueKey);
        
        const reasonText = reason === 'after' ? 'TUỐT SAU KHI Sprint đã đóng băng' : 'TỪ THUỞ NÀO trước cả khi Sprint bắt đầu';

        return `
🚧 <b>LỆCH PHA DEADLINE & SPRINT</b> 🚧

Anh/Chị ${assigneeTag} ơi~ ticket ${issueLink} - <i>${issueSummary}</i> đang nằm trong <b>${sprintName}</b> mà deadline lại cắm ở ngày <b>${dueDate}</b> (${reasonText}) kìa 🫣

Anh/chị tính dùng cỗ máy thời gian của Doraemon để làm task à? Vui lòng update lại Due Date cho khớp với timeline của Sprint giúp em nhé! 💋✨
    `.trim();
    }
}

module.exports = new MessageService();
