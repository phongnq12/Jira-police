const storageService = require('../services/storage.service');
const jiraService = require('../services/jira.service');
const config = require('../config/env');

/**
 * Điều hướng các lệnh nhận từ Telegram Bot
 * @param {object} bot - Instance của TelegramBot
 */
function initCommands(bot) {
    if (!bot) return;

    const testGroupId = String(config.TELEGRAM.TEST_GROUP_ID);

    // Lắng nghe mọi text message để lọc lệnh
    bot.on('message', async (msg) => {
        console.log(`[Telegram] Nhận được tin nhắn rác từ Chat ID: ${msg.chat.id}. Loại chat: ${msg.chat.type}`);

        // Chỉ xử lý tin nhắn trong Test Group hoặc từ tài khoản hợp lệ
        const chatId = String(msg.chat.id);
        if (chatId !== testGroupId && msg.chat.type !== 'private') {
            console.log(`[Telegram] ⛔️ Bỏ qua tin nhắn do khác Group ID. (Config nội bộ: ${testGroupId})`);
            return;
        }

        const text = msg.text || '';
        console.log(`[Telegram] 🟢 Bắt đầu xử lý tin nhắn hợp lệ: "${text}"`);

        // Lệnh: /check_effort [sprint_id]
        if (text.startsWith('/check_effort') || text.startsWith('@JiraMaster check_effort')) {
            await handleCheckEffort(bot, chatId, text);
        }

        // Lệnh: /check_remaining_tasks [sprint_id] hoặc /check_remaining_tasks @name
        if (text.startsWith('/check_remaining_tasks') || text.startsWith('@JiraMaster check_remaining_tasks')) {
            await handleCheckRemainingTasks(bot, chatId, text);
        }

        // Lệnh: /mute_sprint [sprint_id]
        if (text.startsWith('/mute_sprint') || text.startsWith('@JiraMaster mute_sprint')) {
            await handleMuteSprint(bot, chatId, text);
        }

        // Lệnh: /unmute_sprint [sprint_id]
        if (text.startsWith('/unmute_sprint')) {
            await handleUnmuteSprint(bot, chatId, text);
        }
    });
}

/**
 * Logic xử lý lệnh Check Effort
 * Gom nhóm toàn bộ Task trong Sprint và cộng dồn Original Estimate theo từng Assignee
 */
async function handleCheckEffort(bot, chatId, text) {
    // Bóc tách tham số (Ví dụ: /check_effort 142)
    const parts = text.split(' ');
    const sprintId = parts[1]; // Lấy tham số phía sau

    // Gửi tin nhắn "Đang xử lý..." để tạo UX tốt
    const loadingMsg = await bot.sendMessage(chatId, '🔄 Em đang trích xuất dữ liệu từ Jira cho anh. Đợi em xíu nha~ ✨');

    try {
        const projectKey = config.JIRA.PROJECT_KEY || 'PROJ';

        // JQL tìm kiếm các task thuộc Sprint Active hoặc Sprint ID cụ thể
        let jql = `project = "${projectKey}" AND issuetype != Epic`;
        if (sprintId && !isNaN(sprintId)) {
            jql += ` AND sprint = ${sprintId}`;
        } else {
            // Mặc định lấy Sprint đang mở tĩnh của dự án
            jql += ` AND sprint IN openSprints()`;
        }

        // Yêu cầu Jira API trả về thông tin estimate
        const data = await jiraService.searchIssues(jql, ['assignee', 'timeoriginalestimate', 'status', 'sprint']);

        if (!data.issues || data.issues.length === 0) {
            return bot.editMessageText('😢 Em tìm hoài mà không thấy Task nào trong Sprint này hết á anh ơi~', { chat_id: chatId, message_id: loadingMsg.message_id });
        }

        // Tự động detect Tên/ID của Sprint từ Issue đầu tiên
        let detectedSprintName = sprintId ? `Sprint ID ${sprintId}` : 'Current Active Sprint';
        if (data.issues[0].fields.sprint && data.issues[0].fields.sprint.name) {
            detectedSprintName = data.issues[0].fields.sprint.name;
        }

        // === THUẬT TOÁN GOM NHÓM (GROUP BY) MẢNG THEO GIỜ LÀM ===
        const effortMap = {};
        let totalSprintSeconds = 0;

        for (const issue of data.issues) {
            const assigneeName = issue.fields.assignee ? issue.fields.assignee.displayName : 'Unassigned';
            const estimateSeconds = issue.fields.timeoriginalestimate || 0;

            if (!effortMap[assigneeName]) {
                effortMap[assigneeName] = 0;
            }
            effortMap[assigneeName] += estimateSeconds;
            totalSprintSeconds += estimateSeconds;
        }

        // Format Báo cáo trả về Telegram
        let reportText = `📊 <b>BÁO CÁO EFFORT: ${detectedSprintName}</b>\n\n`;
        reportText += `Tổng Task: ${data.issues.length} | Tổng Estimate: ${(totalSprintSeconds / 3600).toFixed(1)}h\n\n`;
        reportText += `<b>Phân bổ theo Nhân sự:</b>\n`;

        // Tính toán và định dạng giờ
        for (const [name, seconds] of Object.entries(effortMap)) {
            const hours = (seconds / 3600).toFixed(1);

            // Logic cảnh báo cấu hình từ biến môi trường
            const underloadHours = config.SPRINT_THRESHOLDS.UNDERLOAD_HOURS;
            const overloadHours = config.SPRINT_THRESHOLDS.OVERLOAD_HOURS;

            let statusIcon = '✅';
            if (hours < underloadHours && name !== 'Unassigned') statusIcon = `⚠️ <i>(Dưới ${underloadHours}h: Trống việc)</i>`;
            if (hours > overloadHours) statusIcon = `🔥 <i>(Trên ${overloadHours}h: Overload)</i>`;

            reportText += `👤 <b>${name}</b> 👉 ${hours}h ${statusIcon}\n`;
        }

        reportText += `\n<i>💡 Dùng /mute_sprint để tắt cảnh báo Sprint này nha~</i>`;

        // Ghi đè tin nhắn loading bằng Kết quả thật
        await bot.editMessageText(reportText, {
            chat_id: chatId,
            message_id: loadingMsg.message_id,
            parse_mode: 'HTML'
        });

    } catch (error) {
        console.error('Lỗi Check Effort:', error.message);
        bot.editMessageText('❌ Ối! Có lỗi xảy ra khi gọi Jira rồi anh ơi~ Xem log giùm em nha 🥺', { chat_id: chatId, message_id: loadingMsg.message_id });
    }
}

/**
 * Logic xử lý lệnh Check Remaining Tasks (Kịch bản 9)
 * Gom nhóm các task chưa hoàn thành theo Assignee, tổng hợp Remaining Estimate.
 * Hỗ trợ xem chi tiết theo tên assignee.
 */
async function handleCheckRemainingTasks(bot, chatId, text) {
    const parts = text.split(' ');
    const param1 = parts[1]; // Có thể là sprint_id hoặc tên assignee
    const param2 = parts.slice(2).join(' '); // Tên assignee (nếu có param1 là sprint_id)

    const loadingMsg = await bot.sendMessage(chatId, '🔄 Em đang kiểm tra danh sách công việc còn lại cho anh~ Đợi em xíu nha 💕');

    try {
        const projectKey = config.JIRA.PROJECT_KEY || 'PROJ';

        // Xây dựng JQL: Lấy task chưa hoàn thành (loại Done, Closed, Cancelled)
        let jql = `project = "${projectKey}" AND issuetype != Epic AND status NOT IN (Done, Closed, Cancelled)`;

        // Xác định sprint_id và assignee filter
        let sprintId = null;
        let assigneeFilter = null;

        if (param1 && !isNaN(param1)) {
            // param1 là sprint_id
            sprintId = param1;
            jql += ` AND sprint = ${sprintId}`;
            // param2 có thể là assignee
            if (param2) assigneeFilter = param2;
        } else if (param1) {
            // param1 là tên assignee (không có sprint_id)
            assigneeFilter = parts.slice(1).join(' ');
            jql += ` AND sprint IN openSprints()`;
        } else {
            // Không có param -> Sprint đang mở
            jql += ` AND sprint IN openSprints()`;
        }

        // Nếu có filter theo assignee, thêm vào JQL
        if (assigneeFilter) {
            // Xử lý thông minh: Nếu user gõ cả dấu [ ] theo placeholder thì xóa đi
            assigneeFilter = assigneeFilter.replace(/^\[|\]$/g, '').trim();
            jql += ` AND assignee = "${assigneeFilter}"`;
        }

        const data = await jiraService.searchIssues(jql, [
            'summary', 'status', 'assignee', 'timeoriginalestimate', 'timespent',
            'timeestimate', 'sprint'
        ]);

        if (!data.issues || data.issues.length === 0) {
            const noTaskMsg = assigneeFilter
                ? `😊 Anh ơi~ <b>${assigneeFilter}</b> không còn task nào chưa xong hết á! Giỏi quá đi~`
                : '😊 Sprint này không còn task nào chưa xong hết á anh ơi~ Giỏi quá đi~ 🎉';
            return bot.editMessageText(noTaskMsg, { chat_id: chatId, message_id: loadingMsg.message_id, parse_mode: 'HTML' });
        }

        // Detect Sprint Name
        let detectedSprintName = sprintId ? `Sprint ID ${sprintId}` : 'Current Active Sprint';
        if (data.issues[0].fields.sprint && data.issues[0].fields.sprint.name) {
            detectedSprintName = data.issues[0].fields.sprint.name;
        }

        // Nếu có assigneeFilter -> Hiển thị chi tiết từng task
        if (assigneeFilter) {
            return await renderDetailView(bot, chatId, loadingMsg, data.issues, detectedSprintName, assigneeFilter);
        }

        // Mặc định: Hiển thị tổng hợp (Summary View)
        return await renderSummaryView(bot, chatId, loadingMsg, data.issues, detectedSprintName);

    } catch (error) {
        console.error('Lỗi Check Remaining Tasks:', error.message);
        bot.editMessageText('❌ Ối! Có lỗi xảy ra khi gọi Jira rồi anh ơi~ Xem log giùm em nha 🥺', { chat_id: chatId, message_id: loadingMsg.message_id });
    }
}

/**
 * Render chế độ Tổng hợp (Summary View):
 * Gom nhóm theo Assignee, hiển thị số task + tổng remaining hours
 */
async function renderSummaryView(bot, chatId, loadingMsg, issues, sprintName) {
    const assigneeMap = {};

    for (const issue of issues) {
        const name = issue.fields.assignee ? issue.fields.assignee.displayName : 'Unassigned';
        const remainingSeconds = issue.fields.timeestimate || 0; // remainingEstimate

        if (!assigneeMap[name]) {
            assigneeMap[name] = { taskCount: 0, totalRemainingSeconds: 0 };
        }
        assigneeMap[name].taskCount++;
        assigneeMap[name].totalRemainingSeconds += remainingSeconds;
    }

    let reportText = `📋 <b>CÔNG VIỆC CÒN LẠI: ${sprintName}</b>\n\n`;
    reportText += `Tổng task chưa xong: <b>${issues.length}</b>\n\n`;

    // Sắp xếp theo remaining giảm dần
    const sorted = Object.entries(assigneeMap).sort((a, b) => b[1].totalRemainingSeconds - a[1].totalRemainingSeconds);

    for (const [name, info] of sorted) {
        const hours = (info.totalRemainingSeconds / 3600).toFixed(1);
        let statusIcon = '';
        if (info.totalRemainingSeconds === 0 && info.taskCount > 0) {
            statusIcon = ' ⚠️ <i>(Chưa estimate)</i>';
        }
        reportText += `👤 <b>${name}</b>: ${info.taskCount} task | ~${hours}h remaining${statusIcon}\n`;
    }

    reportText += `\n<i>💡 Xem chi tiết: /check_remaining_tasks tên_nhân_viên</i>`;

    await bot.editMessageText(reportText, {
        chat_id: chatId,
        message_id: loadingMsg.message_id,
        parse_mode: 'HTML'
    });
}

/**
 * Render chế độ Chi tiết (Detail View):
 * Liệt kê từng task với status và remaining hours
 */
async function renderDetailView(bot, chatId, loadingMsg, issues, sprintName, assigneeName) {
    const baseUrl = config.JIRA.BASE_URL || 'https://your-company.atlassian.net';

    let totalRemainingSeconds = 0;

    // Sắp xếp task theo remaining giảm dần (task nặng nhất lên trước)
    const sortedIssues = issues.sort((a, b) => {
        const remA = a.fields.timeestimate || 0;
        const remB = b.fields.timeestimate || 0;
        return remB - remA;
    });

    let reportText = `📋 <b>CHI TIẾT TASK: ${assigneeName}</b>\n`;
    reportText += `<i>Sprint: ${sprintName}</i>\n\n`;

    for (const issue of sortedIssues) {
        const key = issue.key;
        const summary = issue.fields.summary;
        const status = issue.fields.status ? issue.fields.status.name : 'Unknown';
        const remainingSeconds = issue.fields.timeestimate || 0;
        const remainingHours = (remainingSeconds / 3600).toFixed(1);

        totalRemainingSeconds += remainingSeconds;

        const issueLink = `<a href="${baseUrl}/browse/${key}">${key}</a>`;
        reportText += `• ${issueLink} [${status}] ~${remainingHours}h\n  <i>${summary}</i>\n`;
    }

    const totalHours = (totalRemainingSeconds / 3600).toFixed(1);
    reportText += `\n<b>Tổng: ${issues.length} task | ~${totalHours}h remaining</b>`;
    reportText += `\n\n<i>🫣 Anh ${assigneeName} ơi~ còn ${totalHours}h việc nè, cố lên nha~</i>`;

    await bot.editMessageText(reportText, {
        chat_id: chatId,
        message_id: loadingMsg.message_id,
        parse_mode: 'HTML',
        disable_web_page_preview: true
    });
}

/**
 * Logic xử lý lệnh Mute Sprint (Tắt cảnh báo Effort cho 1 Sprint)
 */
async function handleMuteSprint(bot, chatId, text) {
    const parts = text.split(' ');
    const sprintId = parts[1]; // Phải chỉ định ID

    if (!sprintId) {
        return bot.sendMessage(chatId, '⚠️ Anh ơi~ gõ thêm Sprint ID giùm em. Ví dụ: `/mute_sprint 142` nha~ 💋', { parse_mode: 'Markdown' });
    }

    // Ghi vào file JSON
    storageService.muteSprint(sprintId);
    bot.sendMessage(chatId, `✅ Em đã tắt âm toàn bộ cảnh báo cho Sprint <b>${sprintId}</b> rồi nha~ 🔇`, { parse_mode: 'HTML' });
}

/**
 * Mở kênh lại
 */
async function handleUnmuteSprint(bot, chatId, text) {
    const parts = text.split(' ');
    const sprintId = parts[1];

    if (!sprintId) return;

    storageService.unmuteSprint(sprintId);
    bot.sendMessage(chatId, `🔊 Đã mở lại cảnh báo cho Sprint <b>${sprintId}</b> nha anh~ Em sẽ lại nhắc nhở team thôi 😘`, { parse_mode: 'HTML' });
}

module.exports = {
    initCommands,
    handleCheckEffort
};
