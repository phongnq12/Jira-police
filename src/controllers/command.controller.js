const storageService = require('../services/storage.service');
const { sanitizeJqlString, sanitizeSprintId } = require('../utils/sanitize');
const jiraService = require('../services/jira.service');
const config = require('../config/env');
const projectConfig = require('../config/projects');
const cronController = require('./cron.controller');
const reportOrchestrator = require('../services/report_orchestrator.service');
const bottleneckService = require('../services/bottleneck.service');
const excelService = require('../services/excel.service');
const telegramService = require('../services/telegram.service');

/**
 * Điều hướng các lệnh nhận từ Telegram Bot
 * @param {object} bot - Instance của TelegramBot
 */
function initCommands(bot) {
    if (!bot) return;

    const testGroupId = String(config.TELEGRAM.TEST_GROUP_ID);

    // Lắng nghe mọi text message để lọc lệnh
    bot.on('message', async (msg) => {
        console.log(`[Telegram] 📩 Nhận tin nhắn từ Chat ID: ${msg.chat.id}. Loại chat: ${msg.chat.type}. Text: "${msg.text || '(empty)'}"`);
        console.log(`[Telegram] Timestamp: ${new Date().toISOString()}`);

        // Chú ý: Không chặn chết theo 1 Test Group ID nữa, mà phải linh hoạt theo File Routing.
        const chatId = String(msg.chat.id);
        const mappedProjectKey = projectConfig.getProjectKeyByChatId(chatId, config.JIRA.PROJECT_KEY);

        // NẾU group id này chưa được khai báo TRONG projects.js, và cũng chả phải nhắn Private cho Bot, chặn nó liền:
        if (!projectConfig.projectRoutingMap[chatId] && msg.chat.type !== 'private') {
            console.log(`[Telegram] ⛔️ Bỏ qua tin nhắn do Group ID chưa được đăng ký trong projects.js: ${chatId}`);
            return;
        }

        const text = msg.text || '';
        console.log(`[Telegram] 🟢 Bắt đầu xử lý tin nhắn hợp lệ: "${text}"`);

        // Lệnh: /check_effort [sprint_id]
        if (text.startsWith('/check_effort') || text.startsWith('@JiraMaster check_effort')) {
            await handleCheckEffort(bot, chatId, text, mappedProjectKey);
        }

        // Lệnh: /check_remaining_tasks [sprint_id] hoặc /check_remaining_tasks @name
        if (text.startsWith('/check_remaining_tasks') || text.startsWith('@JiraMaster check_remaining_tasks')) {
            await handleCheckRemainingTasks(bot, chatId, text, mappedProjectKey);
        }

        // Lệnh: /mute_sprint [sprint_id]
        if (text.startsWith('/mute_sprint') || text.startsWith('@JiraMaster mute_sprint')) {
            await handleMuteSprint(bot, chatId, text);
        }

        // Lệnh: /unmute_sprint [sprint_id]
        if (text.startsWith('/unmute_sprint')) {
            await handleUnmuteSprint(bot, chatId, text);
        }

        // Lệnh: /scan_all
        if (text.startsWith('/scan_all') || text.startsWith('@JiraMaster scan_all')) {
            await handleScanAll(bot, chatId);
        }

        // Lệnh: /export_report — Xuất báo cáo Excel chi tiết
        if (text.startsWith('/export_report') || text.startsWith('@JiraMaster export_report')) {
            await handleExportReport(bot, chatId, text, mappedProjectKey);
        }

        // Lệnh: /report_now — ⏸ TẠM TẮT (biểu đồ đang tối ưu)
        if (text.startsWith('/report_now') || text.startsWith('@JiraMaster report_now')) {
            await bot.sendMessage(chatId, '⏸ Chức năng biểu đồ đang được tối ưu. Vui lòng dùng /export_report để xuất báo cáo Excel nhé~');
        }
    });
}

/**
 * Logic xử lý lệnh Check Effort
 * Gom nhóm toàn bộ Task trong Sprint và cộng dồn Original Estimate theo từng Assignee
 */
async function handleCheckEffort(bot, chatId, text, projectKeyFallback) {
    console.log(`[CheckEffort] ========================================`);
    console.log(`[CheckEffort] Bắt đầu xử lý lệnh.`);
    console.log(`[CheckEffort] Tham số gốc: "${text}", ChatID: ${chatId}`);
    console.log(`[CheckEffort] ProjectKey Fallback: ${projectKeyFallback}`);
    // Bóc tách tham số (Ví dụ: /check_effort 142)
    const parts = text.split(' ');
    const sprintId = sanitizeSprintId(parts[1]);
    console.log(`[CheckEffort] Sprint ID sau sanitize: ${sprintId || '(null - dùng openSprints)'}`);

    let loadingMsg = null;
    try {
        loadingMsg = await bot.sendMessage(chatId, '🔄 Em đang trích xuất dữ liệu từ Jira cho anh. Đợi em xíu nha~ ✨');
        console.log(`[CheckEffort] ✅ Đã gửi loading message. ID: ${loadingMsg.message_id}`);
        const projectKey = projectKeyFallback || config.JIRA.PROJECT_KEY || 'PROJ';
        console.log(`[CheckEffort] Project Key sẽ dùng: "${projectKey}"`);

        // JQL lấy TẤT CẢ task trong Sprint (bao gồm Done) để tính đúng tổng effort ban đầu
        let jql = `project = "${projectKey}" AND issuetype != Epic`;
        if (sprintId) {
            jql += ` AND sprint = ${sprintId}`;
        } else {
            // Mặc định lấy Sprint đang mở tĩnh của dự án
            jql += ` AND sprint IN openSprints() AND sprint NOT IN futureSprints()`;
        }
        console.log(`[CheckEffort] 🔍 JQL Query: ${jql}`);

        // Yêu cầu Jira API trả về thông tin estimate, changelog và thông tin sprint
        const fieldsToFetch = ['assignee', 'timeoriginalestimate', 'status', 'sprint', 'customfield_10101', 'issuetype', 'subtasks', 'resolutiondate'];
        const data = await jiraService.searchIssues(jql, fieldsToFetch, 'changelog');

        console.log(`[CheckEffort] 📦 Jira trả về: ${data.issues ? data.issues.length : 0} issues (total: ${data.total})`);

        if (!data.issues || data.issues.length === 0) {
            console.log(`[CheckEffort] ⚠️ Không có issue nào. Kết thúc.`);
            return bot.editMessageText('😢 Em tìm hoài mà không thấy Task nào trong Sprint này hết á anh ơi~', { chat_id: chatId, message_id: loadingMsg.message_id });
        }

        // Tự động detect Tên/ID của Sprint từ issue (ưu tiên Active Sprint)
        let detectedSprintName = sprintId ? `Sprint ID ${sprintId}` : 'Current Active Sprint';
        let globalSprintStartDate = null;

        /**
         * Helper: Parse sprint string từ Jira Server customfield_10101
         * Format: "com.atlassian.greenhopper.service.sprint.Sprint@...[id=X,state=ACTIVE,name=Y,startDate=Z,...]"
         */
        function parseSprintString(sprintStr) {
            const str = String(sprintStr);
            const get = (key) => {
                const match = str.match(new RegExp(`${key}=([^,\\]]+)`));
                return (match && match[1] && match[1] !== '<null>') ? match[1] : null;
            };
            return {
                id: get('id'),
                state: get('state'),
                name: get('name'),
                startDate: get('startDate'),
            };
        }

        // Quét qua các issue để tìm Active Sprint info
        for (const issue of data.issues) {
            // Jira Cloud: sprint field trả object trực tiếp
            if (issue.fields.sprint && issue.fields.sprint.startDate) {
                if (issue.fields.sprint.state === 'active' || !globalSprintStartDate) {
                    globalSprintStartDate = new Date(issue.fields.sprint.startDate);
                    detectedSprintName = issue.fields.sprint.name || detectedSprintName;
                    if (issue.fields.sprint.state === 'active') break; // Active sprint → dùng luôn
                }
                continue;
            }

            // Jira Server: customfield_10101 trả mảng string (ticket có thể nằm trong NHIỀU sprint)
            const cf = issue.fields.customfield_10101;
            if (Array.isArray(cf) && cf.length > 0) {
                let activeSprint = null;
                let lastSprint = null;

                // Parse TẤT CẢ sprint trong mảng, ưu tiên tìm ACTIVE
                for (const sprintStr of cf) {
                    const parsed = parseSprintString(sprintStr);
                    if (!parsed.startDate) continue;

                    lastSprint = parsed; // Track sprint cuối cùng

                    if (parsed.state && parsed.state.toUpperCase() === 'ACTIVE') {
                        activeSprint = parsed;
                        break; // Tìm thấy Active → dừng
                    }
                }

                // Ưu tiên: Active Sprint → Sprint cuối cùng (mới nhất)
                const bestSprint = activeSprint || lastSprint;
                if (bestSprint && bestSprint.startDate) {
                    globalSprintStartDate = new Date(bestSprint.startDate);
                    detectedSprintName = bestSprint.name || detectedSprintName;
                    console.log(`[CheckEffort] 🔎 Tìm thấy sprint: "${bestSprint.name}" (state=${bestSprint.state}, start=${bestSprint.startDate}) từ mảng ${cf.length} sprints`);
                    if (activeSprint) break; // Active sprint → dùng luôn
                }
            }
        }
        console.log(`[CheckEffort] 📅 Sprint Name: "${detectedSprintName}"`);
        console.log(`[CheckEffort] 📅 Sprint Start Date: ${globalSprintStartDate ? globalSprintStartDate.toISOString() : '⚠️ KHÔNG XÁC ĐỊNH ĐƯỢC'}`);

        // === THUẬT TOÁN GOM NHÓM (GROUP BY) MẢNG THEO GIỜ LÀM ===
        const effortMap = {};
        let totalSprintSeconds = 0;
        let totalFilteredTaskCount = 0;
        let skippedDoneBeforeSprintCount = 0;

        // Lọc ticket cha có sub-tasks (Story/Task có con thì bỏ qua, standalone thì tính)
        for (const issue of data.issues) {
            const status = issue.fields.status ? issue.fields.status.name.toLowerCase() : '';
            if (status === 'cancelled') continue;

            const issueTypeName = issue.fields.issuetype ? issue.fields.issuetype.name.toLowerCase() : '';
            const hasSubtasks = issue.fields.subtasks && issue.fields.subtasks.length > 0;
            const isExemptParent = issueTypeName === 'epic' || 
                (['story', 'user story', 'task'].includes(issueTypeName) && hasSubtasks);
            if (isExemptParent) continue;

            // --- Lọc loại bỏ Task Done từ trước khi Sprint bắt đầu ---
            if (['done', 'closed', 'resolved'].includes(status) && globalSprintStartDate) {
                let doneDate = null;

                // Cách 1: Tìm lần chuyển sang Done GẦN NHẤT trong changelog
                if (issue.changelog && issue.changelog.histories) {
                    const histories = [...issue.changelog.histories].sort((a,b) => new Date(b.created) - new Date(a.created));
                    for (const history of histories) {
                        for (const item of history.items) {
                            if (item.field === 'status' && item.toString && ['done', 'closed', 'resolved'].includes(item.toString.toLowerCase())) {
                                doneDate = new Date(history.created);
                                break;
                            }
                        }
                        if (doneDate) break;
                    }
                }

                // Cách 2: Fallback dùng resolutiondate
                if (!doneDate && issue.fields.resolutiondate) {
                    doneDate = new Date(issue.fields.resolutiondate);
                }

                if (doneDate && doneDate < globalSprintStartDate) {
                    console.log(`[CheckEffort] 🚫 Bỏ qua ${issue.key} — Done ${doneDate.toISOString()} < Sprint Start ${globalSprintStartDate.toISOString()}`);
                    skippedDoneBeforeSprintCount++;
                    continue;
                }
            }
            // ---------------------------------------------------------

            totalFilteredTaskCount++;

            const assigneeIdentifier = issue.fields.assignee ? (issue.fields.assignee.emailAddress || issue.fields.assignee.displayName) : 'Unassigned';
            const assigneeName = issue.fields.assignee ? (issue.fields.assignee.displayName) : 'Unassigned';
            const estimateSeconds = issue.fields.timeoriginalestimate || 0;

            if (!effortMap[assigneeIdentifier]) {
                effortMap[assigneeIdentifier] = {
                    displayName: assigneeName,
                    seconds: 0
                };
            }
            effortMap[assigneeIdentifier].seconds += estimateSeconds;
            totalSprintSeconds += estimateSeconds;
        }

        // Format Báo cáo trả về Telegram
        console.log(`[CheckEffort] 📊 Kết quả: ${totalFilteredTaskCount} task tính effort, ${skippedDoneBeforeSprintCount} task Done trước Sprint bị loại`);

        let reportText = `📊 <b>BÁO CÁO EFFORT: ${detectedSprintName}</b>\n\n`;
        reportText += `Tổng Task: ${totalFilteredTaskCount} | Tổng Estimate: ${(totalSprintSeconds / 3600).toFixed(1)}h`;
        if (skippedDoneBeforeSprintCount > 0) {
            reportText += ` | <i>(Đã loại ${skippedDoneBeforeSprintCount} task Done trước Sprint)</i>`;
        }
        reportText += `\n\n`;
        reportText += `<b>Phân bổ theo Nhân sự:</b>\n`;

        // Tính toán và định dạng giờ
        for (const [identifier, info] of Object.entries(effortMap)) {
            const hours = (info.seconds / 3600).toFixed(1);
            const name = info.displayName;

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
        console.error('[CheckEffort] ❌ LỖI NGHIÊM TRỌNG:', error.message);
        console.error('[CheckEffort] Stack trace:', error.stack);
        if (error.response) {
            console.error('[CheckEffort] HTTP Status:', error.response.status);
            console.error('[CheckEffort] Response data:', JSON.stringify(error.response.data));
        }
        if (loadingMsg) {
            bot.editMessageText('❌ Ối! Có lỗi xảy ra khi gọi Jira rồi anh ơi~ Xem log giùm em nha 🥺', { chat_id: chatId, message_id: loadingMsg.message_id }).catch(e => console.error(e));
        } else {
            bot.sendMessage(chatId, '❌ Ối! Có lỗi xảy ra rồi anh ơi~').catch(e => console.error(e));
        }
    }
}

/**
 * Logic xử lý lệnh Check Remaining Tasks (Kịch bản 9)
 * Gom nhóm các task chưa hoàn thành theo Assignee, tổng hợp Remaining Estimate.
 * Hỗ trợ xem chi tiết theo tên assignee.
 */
async function handleCheckRemainingTasks(bot, chatId, text, projectKeyFallback) {
    console.log(`[CheckRemaining] Bắt đầu xử lý. Tham số: ${text}`);
    const parts = text.split(' ');
    const param1 = parts[1]; // Có thể là sprint_id hoặc tên assignee
    const param2 = parts.slice(2).join(' '); // Tên assignee (nếu có param1 là sprint_id)

    let loadingMsg = null;
    try {
        loadingMsg = await bot.sendMessage(chatId, '🔄 Em đang kiểm tra danh sách công việc còn lại cho anh~ Đợi em xíu nha 💕');
        const projectKey = projectKeyFallback || config.JIRA.PROJECT_KEY || 'PROJ';

        // Xây dựng JQL: Lấy task chưa hoàn thành (loại Done, Closed, Cancelled). Hạn chế quăng "User Story" vào JQL để tránh lỗi 400.
        let jql = `project = "${projectKey}" AND issuetype != Epic AND status NOT IN (Done, Closed, Cancelled)`;

        // Xác định sprint_id và assignee filter
        let sprintId = null;
        let assigneeFilter = null;

        const validSprintId = sanitizeSprintId(param1);
        if (validSprintId) {
            sprintId = validSprintId;
            jql += ` AND sprint = ${sprintId}`;
            if (param2) assigneeFilter = param2;
        } else if (param1) {
            assigneeFilter = parts.slice(1).join(' ');
            jql += ` AND sprint IN openSprints()`;
        } else {
            jql += ` AND sprint IN openSprints()`;
        }

        // Sanitize assignee input trước khi gom vào JQL
        if (assigneeFilter) {
            assigneeFilter = sanitizeJqlString(assigneeFilter.replace(/^\[|\]$/g, ''));
            if (assigneeFilter) {
                jql += ` AND assignee = "${assigneeFilter}"`;
            }
        }

        const data = await jiraService.searchIssues(jql, [
            'summary', 'status', 'assignee', 'timeoriginalestimate', 'timespent',
            'timeestimate', 'sprint', 'issuetype', 'subtasks'
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
        if (loadingMsg) {
            bot.editMessageText('❌ Ối! Có lỗi xảy ra khi gọi Jira rồi anh ơi~ Xem log giùm em nha 🥺', { chat_id: chatId, message_id: loadingMsg.message_id }).catch(e => console.error(e));
        }
    }
}

/**
 * Render chế độ Tổng hợp (Summary View):
 * Gom nhóm theo Assignee, hiển thị số task + tổng remaining hours
 */
async function renderSummaryView(bot, chatId, loadingMsg, issues, sprintName) {
    const assigneeMap = {};
    // Lọc ticket cha có sub-tasks (giữ lại standalone)
    for (const issue of issues) {
        const issueTypeName = issue.fields.issuetype ? issue.fields.issuetype.name.toLowerCase() : '';
        const hasSubtasks = issue.fields.subtasks && issue.fields.subtasks.length > 0;
        const isExemptParent = issueTypeName === 'epic' || 
            (['story', 'user story', 'task'].includes(issueTypeName) && hasSubtasks);
        if (isExemptParent) continue;

        const identifier = issue.fields.assignee ? (issue.fields.assignee.emailAddress || issue.fields.assignee.displayName) : 'Unassigned';
        const displayName = issue.fields.assignee ? (issue.fields.assignee.displayName) : 'Unassigned';
        const remainingSeconds = issue.fields.timeestimate || 0; // remainingEstimate

        if (!assigneeMap[identifier]) {
            assigneeMap[identifier] = { 
                displayName: displayName, 
                taskCount: 0, 
                totalRemainingSeconds: 0 
            };
        }
        assigneeMap[identifier].taskCount++;
        assigneeMap[identifier].totalRemainingSeconds += remainingSeconds;
    }

    let reportText = `📋 <b>CÔNG VIỆC CÒN LẠI: ${sprintName}</b>\n\n`;

    // Sắp xếp theo remaining giảm dần
    const sorted = Object.entries(assigneeMap).sort((a, b) => b[1].totalRemainingSeconds - a[1].totalRemainingSeconds);
    
    // Tính tổng số task đã duyệt qua (lọc bỏ ticket cha)
    let totalFilteredTaskCount = 0;
    for (const [identifier, info] of sorted) {
        totalFilteredTaskCount += info.taskCount;
    }

    reportText += `Tổng task chưa xong: <b>${totalFilteredTaskCount}</b>\n\n`;

    for (const [identifier, info] of sorted) {
        const hours = (info.totalRemainingSeconds / 3600).toFixed(1);
        const name = info.displayName;
        let statusIcon = '';
        if (info.totalRemainingSeconds === 0 && info.taskCount > 0) {
            statusIcon = ' ⚠️ <i>(Chưa estimate)</i>';
        }
        
        reportText += `👤 <b>${name}</b> 👉 ${hours}h <i>(${info.taskCount} task)</i> ${statusIcon}\n`;
    }

    reportText += `\n<i>💡 Dùng /check_remaining_tasks [tên_người] để xem chi tiết nhé~</i>`;

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

    // Lọc bỏ ticket cha trước
    const filteredIssues = issues.filter(issue => {
        const issueTypeName = issue.fields.issuetype ? issue.fields.issuetype.name.toLowerCase() : '';
        const hasSubtasks = issue.fields.subtasks && issue.fields.subtasks.length > 0;
        const isExemptParent = issueTypeName === 'epic' || 
            (['story', 'user story', 'task'].includes(issueTypeName) && hasSubtasks);
        return !isExemptParent;
    });

    let totalRemainingSeconds = 0;

    // Sắp xếp task theo remaining giảm dần (task nặng nhất lên trước)
    const sortedIssues = filteredIssues.sort((a, b) => {
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
    reportText += `\n<b>Tổng: ${filteredIssues.length} task | ~${totalHours}h remaining</b>`;
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

/**
 * Logic xử lý lệnh Quét toàn diện (Bỏ qua Active Sprint)
 */
async function handleScanAll(bot, chatId) {
    const loadingMsg = await bot.sendMessage(chatId, '🔄 Em đang quét lại toàn bộ ngóc ngách của Dự Án nha. Đợi em chạy báo cáo một lát~ 🚀');
    try {
        await cronController.runDailyReport(true, chatId); // true = isScanAll, truyền thêm chatId để chỉ quét dự án của group này
        bot.editMessageText('✅ Em đã gửi xong báo cáo quét toàn diện trên kênh thông báo chung rồi nha! Bầu trời vẫn xanh đúng không anh? 💖', { chat_id: chatId, message_id: loadingMsg.message_id });
    } catch (error) {
        console.error('Lỗi Scan All:', error.message);
        bot.editMessageText('❌ Ối! Có lỗi xảy ra khi quét dự án rồi anh ơi~ Xem lại log server giúp em nhé 🥺', { chat_id: chatId, message_id: loadingMsg.message_id });
    }
}

/**
 * Logic xử lý lệnh Export Report (Xuất báo cáo Excel)
 * Thu thập metrics → chạy bottleneck analysis → tạo Excel → gửi file qua Telegram
 */
async function handleExportReport(bot, chatId, text, projectKeyFallback) {
    console.log(`[ExportReport] Bắt đầu tải báo cáo. Tham số: ${text}`);
    const parts = text.split(' ');
    let sprintIdRaw = parts[1];
    if (text.startsWith('@JiraMaster')) {
        sprintIdRaw = parts[2];
    }
    const sprintId = sanitizeSprintId(sprintIdRaw);

    let loadingMsg = null;
    try {
        loadingMsg = await bot.sendMessage(chatId, '📊 Em đang tổng hợp dữ liệu và xuất báo cáo Excel cho anh~ Đợi em xíu nha! ✨');
        const projectKey = projectKeyFallback || config.JIRA.PROJECT_KEY || 'PROJ';

        // 1. Thu thập metrics
        const metricsData = await reportOrchestrator.collectMetrics(projectKey, sprintId);
        if (!metricsData) {
            return bot.editMessageText('😢 Em không tìm thấy task nào trong Active Sprint để làm báo cáo á anh ơi~', { chat_id: chatId, message_id: loadingMsg.message_id });
        }

        // 2. Chạy bottleneck analysis
        let bottleneckData = null;
        try {
            await bot.editMessageText('🔍 Em đang phân tích Bottleneck cho từng ticket... Chờ em tí nhé 💪', { chat_id: chatId, message_id: loadingMsg.message_id });
            bottleneckData = await reportOrchestrator.runBottleneckAnalysis(metricsData.issues);
        } catch (bottleneckErr) {
            console.error('[ExportReport] Lỗi bottleneck analysis:', bottleneckErr.message);
        }

        // 3. Tạo Excel
        const reportData = {
            bottleneck: bottleneckData,
            assigneeEfficiency: metricsData.assigneeEfficiency,
            summary: {
                totalTasks: metricsData.metrics.totalTasks,
                overdueTasks: metricsData.metrics.overdueTasks,
                blockedTasks: metricsData.metrics.blockedTasks,
                missingEst: metricsData.metrics.missingEst,
                totalTimeSpentHours: parseFloat((metricsData.metrics.totalTimeSpentSeconds / 3600).toFixed(1)),
                bottleneckStatus: bottleneckData?.summary?.bottleneckStatus || 'N/A',
                totalReopens: bottleneckData?.summary?.totalReopens || 0
            }
        };

        // Cập nhật reopens vào assignee efficiency nếu có data bottleneck
        if (bottleneckData?.issueAnalysis) {
            const reopenMap = {};
            for (const item of bottleneckData.issueAnalysis) {
                if (!reopenMap[item.assignee]) reopenMap[item.assignee] = 0;
                reopenMap[item.assignee] += item.reopenCount;
            }
            for (const ae of reportData.assigneeEfficiency) {
                ae.reopens = reopenMap[ae.name] || 0;
            }
        }

        const excelBuffer = await excelService.generateReport(reportData, projectKey);

        // 4. Gửi file qua Telegram
        const today = new Date().toLocaleDateString('vi-VN').replace(/\//g, '-');
        const filename = `report_${projectKey}_${today}.xlsx`;

        await telegramService.sendDocument(
            excelBuffer,
            filename,
            `📊 <b>Báo cáo chi tiết</b> — ${metricsData.sprintName || projectKey}\n\n💡 File Excel gồm 3 Sheet: Bottleneck Tasks, Assignee Efficiency, Project Summary.`,
            chatId
        );

        await bot.editMessageText('✅ Em đã gửi file báo cáo Excel rồi nha anh~ Xem giùm em nhé 💖', { chat_id: chatId, message_id: loadingMsg.message_id });

    } catch (error) {
        console.error('[ExportReport] Lỗi:', error.message);
        if (loadingMsg) {
            bot.editMessageText('❌ Ối! Có lỗi xảy ra khi tạo báo cáo Excel rồi anh ơi~ Xem log giùm em nha 🥺', { chat_id: chatId, message_id: loadingMsg.message_id }).catch(e => console.error(e));
        }
    }
}

/**
 * Logic xử lý lệnh Report Now (Chạy báo cáo biểu đồ ngay lập tức)
 */
async function handleReportNow(bot, chatId) {
    const loadingMsg = await bot.sendMessage(chatId, '📊 Em đang chạy Reporting job ngay bây giờ cho anh~ Đợi em xíu nha! 🚀');
    try {
        await cronController.runReportingJob(chatId);
        bot.editMessageText('✅ Đã chạy xong báo cáo! Các biểu đồ đã được gửi ở trên nha anh~ 💖', { chat_id: chatId, message_id: loadingMsg.message_id });
    } catch (error) {
        console.error('[ReportNow] Lỗi:', error.message);
        bot.editMessageText('❌ Ối! Có lỗi xảy ra khi chạy báo cáo rồi anh ơi~ 🥺', { chat_id: chatId, message_id: loadingMsg.message_id });
    }
}

module.exports = {
    initCommands,
    handleCheckEffort
};
