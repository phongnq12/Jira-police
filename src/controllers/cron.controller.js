const { CronJob } = require('cron');
const jiraService = require('../services/jira.service');
const messageService = require('../services/message.service');
const notificationService = require('../services/notification.service');
const storageService = require('../services/storage.service');
const reportOrchestrator = require('../services/report_orchestrator.service');
const telegramService = require('../services/telegram.service');
const snapshotRepo = require('../database/snapshot.repo');
const env = require('../config/env');
const projectConfig = require('../config/projects'); // Module quản lý nhóm telegram -> Jira Project

/**
 * Hàm hỗ trợ tạm dừng (sleep) để tránh bị Rate Limit 429
 */
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Lấy thông tin Active Sprint từ custom field của Jira trả về
 * Hỗ trợ giao tiếp đa nền tảng (Jira Server / Jira Cloud)
 */
function getActiveSprintInfo(fields) {
    if (fields.sprint && fields.sprint.state === 'active') {
        return {
            id: String(fields.sprint.id),
            name: fields.sprint.name,
            startDate: fields.sprint.startDate,
            endDate: fields.sprint.endDate
        };
    }
    for (const key of Object.keys(fields)) {
        if (key.startsWith('customfield_')) {
            const val = fields[key];
            if (Array.isArray(val) && val.length > 0 && typeof val[0] === 'string' && val[0].includes('state=ACTIVE')) {
                const activeString = val.find(s => typeof s === 'string' && s.includes('state=ACTIVE'));
                if (activeString) {
                    const idMatch = activeString.match(/id=([^,\]]+)/);
                    const nameMatch = activeString.match(/name=([^,\]]+)/);
                    const startMatch = activeString.match(/startDate=([^,\]]+)/);
                    const endMatch = activeString.match(/endDate=([^,\]]+)/);
                    return {
                        id: idMatch ? idMatch[1] : null,
                        name: nameMatch ? nameMatch[1] : 'Active Sprint',
                        startDate: startMatch ? startMatch[1] : null,
                        endDate: endMatch ? endMatch[1] : null
                    };
                }
            }
        }
    }
    return null;
}

/**
 * Quét toàn bộ các task đang mở và kiểm tra các điều kiện cảnh báo.
 * @param {boolean} isScanAll 
 * @param {string} specificChatId 
 */
async function runDailyReport(isScanAll = false, specificChatId = null) {
    console.log(`[Cronjob] Bắt đầu chạy luồng quét Scheduled Report... (Scan All: ${isScanAll}, Target Chat: ${specificChatId || 'All'})`);
    try {
        // Thay vì chỉ chạy cho 1 dự án lấy từ ENV, ta lấy toàn bộ các dự án đã khai báo trong projects.js
        let activeProjects = projectConfig.getAllActiveProjects();
        
        if (specificChatId) {
            activeProjects = activeProjects.filter(p => p.chatId.toString() === specificChatId.toString());
        }
        
        if (activeProjects.length === 0) {
            console.log(`[Cronjob] ⚠️ Hệ thống chưa khai báo bất kỳ Group ID / Project Key nào trong projects.js`);
            return;
        }

        console.log(`[Cronjob] Tìm thấy ${activeProjects.length} dự án cần quét:`, activeProjects.map(p => p.jiraProjectKey));

        // CHẠY VÒNG LẶP CHO TỪNG DỰ ÁN — mỗi project có try-catch riêng để lỗi 1 nhóm không ảnh hưởng nhóm khác
        for (const projectInfo of activeProjects) {
          try {
            console.log(`\n======================================================`);
            console.log(`[Cronjob] Đang quét dự án: [${projectInfo.jiraProjectKey}] đẩy về Group: [${projectInfo.chatId}]`);
            console.log(`======================================================\n`);
            
            // Lấy TẤT CẢ task trong Active Sprint (bao gồm Done) — Cancelled/Done được lọc bằng JS phía dưới
            // /scan_all cũng chỉ quét Active Sprint, khác Daily Cron ở chỗ chạy thủ công theo yêu cầu
            let jql = `project = "${projectInfo.jiraProjectKey}" AND issuetype != Epic AND sprint IN openSprints() AND sprint NOT IN futureSprints()`;

        // Yêu cầu Jira API trả về các trường cần thiết để phân tích (bao gồm sprint để kiểm tra mute)
        const data = await jiraService.searchIssues(jql, [
            'summary', 'status', 'assignee', 'duedate', 'timeoriginalestimate', 'timespent', 'issuetype', 'sprint', 'subtasks', 'customfield_10020', 'customfield_10101'
        ]);

        if (!data.issues || data.issues.length === 0) {
            console.log(`[Cronjob] Dự án [${projectInfo.jiraProjectKey}] không có task nào đang mở/nợ.`);
            continue; // Dùng continue để chuyển sang dự án tiếp theo, không dùng return làm ngắt cả chu kỳ
        }

        // Kiểm tra Mute Sprint: Nếu toàn bộ issues thuộc 1 sprint bị mute → skip
        const sprintIds = new Set();
        for (const issue of data.issues) {
            const activeInfo = getActiveSprintInfo(issue.fields);
            if (activeInfo && activeInfo.id) {
                sprintIds.add(String(activeInfo.id));
            }
        }
        const mutedSprintIds = [...sprintIds].filter(id => storageService.isSprintMuted(id));
        if (mutedSprintIds.length > 0) {
            // Lọc bỏ các issues thuộc sprint đã bị mute
            const originalCount = data.issues.length;
            data.issues = data.issues.filter(issue => {
                const activeInfo = getActiveSprintInfo(issue.fields);
                const sid = activeInfo && activeInfo.id ? String(activeInfo.id) : null;
                return !sid || !storageService.isSprintMuted(sid);
            });
            console.log(`[Cronjob] 🔇 Đã lọc ${originalCount - data.issues.length} tasks thuộc Sprint bị Mute (IDs: ${mutedSprintIds.join(', ')})`);

            if (data.issues.length === 0) {
                console.log(`[Cronjob] Tất cả tasks thuộc Sprint đang bị Mute. Bỏ qua dự án [${projectInfo.jiraProjectKey}].`);
                continue;
            }
        }

        // Lấy thời điểm hôm nay (reset giờ về 0 để so sánh ranh giới ngày)
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        let overdueCount = 0;
        let deadlineTodayCount = 0;
        let overEstimateCount = 0;
        let missingInfoCount = 0;

        let trackingWorklogCount = 0;
        let noActiveTaskCount = 0;
        let outOfBoundsCount = 0;

        // KB9 Mode B: Bộ theo dõi sub-task activity per-member
        const userActivityTracker = {};


        for (const issue of data.issues) {
            const key = issue.key;
            const fields = issue.fields;

            const summary = fields.summary;
            const status = fields.status ? fields.status.name : 'Unknown';
            const assigneeName = fields.assignee ? (fields.assignee.emailAddress || fields.assignee.displayName) : null;
            const issueTypeName = fields.issuetype ? fields.issuetype.name : 'Unknown';

            // --- KIỂM TRA KB6 & KB5 & KB7: THIẾU THÔNG TIN & TRÀN ESTIMATE & THIẾU LOG WORK --- //
            const initStatuses = ['to do', 'open'];
            const isInitStatus = initStatuses.includes(status.toLowerCase());
            const isBugLike = issueTypeName.toLowerCase().includes('bug');

            const missingFields = [];

            // Kiểm tra ticket cha: Epic luôn bỏ qua. Story/Task chỉ bỏ qua nếu CÓ sub-task bên trong.
            // Nếu Story/Task không có sub-task → coi như standalone ticket và quét bình thường.
            const hasSubtasks = fields.subtasks && fields.subtasks.length > 0;
            const isExemptParent = issueTypeName.toLowerCase() === 'epic' || 
                (['story', 'user story', 'task'].includes(issueTypeName.toLowerCase()) && hasSubtasks);
            
            // Due date: Bỏ qua kiểm tra nếu đang ở trạng thái To do/Open (áp dụng MỌI LOẠI ticket)
            // VÀ bỏ qua nếu là vé cha (Epic, Story, Task)
            if (!fields.duedate && !isInitStatus && !isExemptParent) {
                missingFields.push('Due Date');
            }

            // Estimate: Bỏ qua kiểm tra nếu đang ở To do/Open NHƯNG CHỈ áp dụng cho vé Bug/Sub-bug
            // VÀ bỏ qua nếu là vé cha (Epic, Story, Task)
            if (!fields.timeoriginalestimate && fields.timeoriginalestimate !== 0 && !isExemptParent) {
                if (!(isInitStatus && isBugLike)) {
                    missingFields.push('Original Estimate');
                }
            }

            // [Kịch bản 6]: Báo động nếu task vứt trống thông tin Planning
            // Mặc định luôn bỏ qua các task đã đóng/hủy (Cancelled, Done, Resolved, Closed)
            const deadStatuses = ['cancelled', 'done', 'resolved', 'closed'];
            const isIgnored = deadStatuses.includes(status.toLowerCase());

            if (missingFields.length > 0 && !isIgnored) {
                missingInfoCount++;
                console.log(`[Cronjob] Task ${key} thiếu thông tin: ${missingFields.join(', ')}. Tiến hành cảnh báo...`);
                const missingMsg = messageService.missingInformationAlert(key, summary, assigneeName, missingFields);
                await notificationService.dispatchAlert(`[Jira Master] 📝 THIẾU THÔNG TIN PLANNING`, missingMsg, 'info', projectInfo.chatId);
                await sleep(1000); // Tạm nghỉ 1s để tránh Telegram Rate Limit
            }

            // [Kịch bản 7]: Task đang chạy thực tế nhưng Time Spent đang là 0
            if ((status.toLowerCase().includes('in progress') || status.toLowerCase().includes('doing')) && !isExemptParent) {
                const timeSpent = fields.timespent || 0;
                if (timeSpent === 0) {
                    trackingWorklogCount++;
                    const alertMsg = messageService.missingWorkLogAlert(key, summary, assigneeName, status);
                    await notificationService.dispatchAlert(`[Jira Master] ⏳ QUÊN LOG WORK`, alertMsg, 'warning', projectInfo.chatId);
                    await sleep(1000); // Tạm nghỉ 1s
                }
            }

            // [Kịch bản 5]: Kiểm tra xem số giờ Log Work có vượt mức Estimate gốc ban đầu chưa
            // Bỏ qua các task đã đóng (Done/Closed/Cancelled/Resolved) để tránh spam khi /scan_all
            if (fields.timeoriginalestimate && fields.timespent && !isIgnored) {
                if (fields.timespent > fields.timeoriginalestimate) { // Cùng đơn vị là Seconds (Giây)
                    overEstimateCount++;
                    // Quy đổi giây sang giờ cho PM dễ đọc (VD: 3600s -> 1h)
                    const origHours = (fields.timeoriginalestimate / 3600).toFixed(1) + 'h';
                    const spentHours = (fields.timespent / 3600).toFixed(1) + 'h';

                    const overMsg = messageService.overEstimateAlert(key, summary, assigneeName, origHours, spentHours);
                    await notificationService.dispatchAlert(`[Jira Master] ⚠️ VƯỢT ESTIMATE`, overMsg, 'warning', projectInfo.chatId);
                    await sleep(1000); // Tạm nghỉ 1s
                }
            }

            // --- KIỂM TRA KB3 & KB4: QUÁ HẠN VÀ DEADLINE --- //
            // CHỈ áp dụng cho Sub-tasks/Bugs. Loại bỏ hoàn toàn các vé Cha (Epic, Story, Task) theo yêu cầu
            if (fields.duedate && !isIgnored && !isExemptParent) {
                const dueDate = new Date(fields.duedate);
                dueDate.setHours(0, 0, 0, 0);

                const diffTime = today - dueDate;
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); // Số ngày chênh lệch

                if (diffDays > 0) {
                    overdueCount++;
                    // [Kịch bản 3]: Đã quá hạn (Overdue)
                    const overdueMsg = messageService.overdueAlert(key, summary, assigneeName, diffDays);
                    await notificationService.dispatchAlert(`[Jira Master] 🔥 TASK QUÁ HẠN`, overdueMsg, 'error', projectInfo.chatId);
                    await sleep(1000); // Tạm nghỉ 1s
                } else if (diffDays === 0) {
                    deadlineTodayCount++;
                    // [Kịch bản 4]: Đúng ngày hôm nay là Deadline (Due date = Today)
                    const deadlineMsg = messageService.deadlineTodayAlert(key, summary, assigneeName, status);
                    await notificationService.dispatchAlert(`[Jira Master] 🚨 DEADLINE HÔM NAY`, deadlineMsg, 'warning', projectInfo.chatId);
                    await sleep(1000); // Tạm nghỉ 1s
                }
            }

            // --- KIỂM TRA KB10: DUE DATE NẰM NGOÀI THỜI GIAN SPRINT --- //
            const activeSprint = getActiveSprintInfo(fields);
            
            // KB10 áp dụng cho MỌI trạng thái của ticket (ngoại trừ Cancelled)
            if (fields.duedate && activeSprint && status.toLowerCase() !== 'cancelled' && !isExemptParent) {
                const dueDateObj = new Date(fields.duedate);
                dueDateObj.setHours(0, 0, 0, 0);

                if (activeSprint.startDate && activeSprint.endDate) {
                    const sprintStart = new Date(activeSprint.startDate);
                    sprintStart.setHours(0, 0, 0, 0);

                    const sprintEnd = new Date(activeSprint.endDate);
                    sprintEnd.setHours(0, 0, 0, 0);

                    let reason = null;
                    if (dueDateObj > sprintEnd) {
                        reason = 'after';
                    } else if (dueDateObj < sprintStart) {
                        reason = 'before';
                    }

                    if (reason) {
                        outOfBoundsCount++;
                        
                        const formatDDMMYYYY = (date) => {
                            const d = date.getDate().toString().padStart(2, '0');
                            const m = (date.getMonth() + 1).toString().padStart(2, '0');
                            const y = date.getFullYear();
                            return `${d}/${m}/${y}`;
                        };
                        const dueDateStr = formatDDMMYYYY(dueDateObj);
                        
                        const alertMsg = messageService.outOfSprintBoundsAlert(key, summary, assigneeName, activeSprint.name || 'Active Sprint', dueDateStr, reason);
                        await notificationService.dispatchAlert(`[Jira Master] 🚧 LỆCH PHA SPRINT`, alertMsg, 'warning', projectInfo.chatId);
                        await sleep(1000);
                    }
                }
            }

            // --- KIỂM TRA KB9: CHƯA BẮT ĐẦU CÔNG VIỆC (GOM THEO MEMBER) --- //
            // Gom TOÀN BỘ activity (sub-task + standalone) theo member.
            // Nếu member có BẤT KỲ task nào In Progress → skip KB9 hoàn toàn.
            const hasEstimate = fields.timeoriginalestimate && fields.timeoriginalestimate > 0;
            const passiveStatuses = ['to do', 'open', 'reopen'];
            const isPassive = passiveStatuses.includes(status.toLowerCase());
            const isStandaloneTask = ['story', 'user story', 'task'].includes(issueTypeName.toLowerCase()) && !hasSubtasks;

            if (assigneeName && !isIgnored && !isExemptParent) {
                if (!userActivityTracker[assigneeName]) {
                    userActivityTracker[assigneeName] = {
                        displayName: assigneeName,
                        activeCount: 0,           // Đếm task đang In Progress/Done
                        passiveSubTaskKeys: [],    // Sub-task đang passive (To Do/Open)
                        passiveStandaloneKeys: []  // Standalone task đang passive + có estimate
                    };
                }

                if (isPassive) {
                    if (isStandaloneTask && hasEstimate) {
                        userActivityTracker[assigneeName].passiveStandaloneKeys.push(key);
                    } else if (!isStandaloneTask) {
                        userActivityTracker[assigneeName].passiveSubTaskKeys.push(key);
                    }
                } else {
                    // Chỉ tính "đang làm thật" (In Progress, Doing, Review...) là active
                    // Done/Resolved/Closed KHÔNG tính — dev cần bắt đầu task mới
                    const doneStatuses = ['done', 'resolved', 'closed'];
                    if (!doneStatuses.includes(status.toLowerCase())) {
                        userActivityTracker[assigneeName].activeCount++;
                    }
                }
            }
        }

        // Sau vòng lặp: Kiểm tra từng member — chỉ cảnh báo nếu KHÔNG CÓ task nào In Progress
        for (const [userId, activity] of Object.entries(userActivityTracker)) {
            const totalPassive = activity.passiveSubTaskKeys.length + activity.passiveStandaloneKeys.length;
            if (activity.activeCount === 0 && totalPassive > 0) {
                noActiveTaskCount++;
                // Gộp tất cả ticket (standalone + sub-task) vào 1 tin nhắn duy nhất
                const allPassiveKeys = [...activity.passiveStandaloneKeys, ...activity.passiveSubTaskKeys];
                console.log(`[Cronjob] Member ${activity.displayName} không có task nào In Progress. Tickets: ${allPassiveKeys.join(', ')}`);
                const msg = messageService.noActiveTaskAlert(activity.displayName, allPassiveKeys);
                await notificationService.dispatchAlert(`[Jira Master] 🚀 CHƯA BẮT ĐẦU CÔNG VIỆC`, msg, 'warning', projectInfo.chatId);
                await sleep(1000);
            }
        }

        console.log(`\n[Cronjob] Phân tích hoàn tất ${data.issues.length} tasks chưa giải quyết.`);
        console.log(`  📊 Thống kê rủi ro:`);
        console.log(`  - ⚠️ Tràn Estimate: ${overEstimateCount}`);
        console.log(`  - 🚨 Hạn chót hôm nay: ${deadlineTodayCount}`);
        console.log(`  - 🔥 Quá hạn (Overdue): ${overdueCount}`);
        console.log(`  - 📝 Kịch bản Dư Thông Tin: ${missingInfoCount}`);
        console.log(`  - ⏳ Kịch bản Tàng Hình Log Work: ${trackingWorklogCount}`);
        console.log(`  - 🚀 Kịch bản Chưa Bắt Đầu: ${noActiveTaskCount}`);
        console.log(`  - 🚧 Kịch bản Lệch Pha Sprint: ${outOfBoundsCount}`);

        if ((overEstimateCount + deadlineTodayCount + overdueCount + missingInfoCount + trackingWorklogCount + noActiveTaskCount + outOfBoundsCount) === 0) {
            console.log(`  => ✅ KHÔNG CÓ CẢNH BÁO NÀO TỪ MỤC CHÍNH. Gửi thông báo khích lệ (All Clear).\n`);
            
            const allClearMsg = messageService.allClearAlert();
            await notificationService.dispatchAlert(`[Jira Master] 🌟 BẦU TRỜI TRONG XANH`, allClearMsg, 'info', projectInfo.chatId);
        } else {
            console.log(`  => 📡 Đã phát lệnh nã Notification.\n`);
        }

          } catch (projectError) {
              console.error(`[Cronjob] ❌ Lỗi khi quét dự án [${projectInfo.jiraProjectKey}] cho Group [${projectInfo.chatId}]:`, projectError.message);
              console.error('[Cronjob] Stack:', projectError.stack);
              // TIẾP TỤC xử lý các nhóm còn lại, KHÔNG DỪNG
          }
        } // ĐÓNG VÒNG LẶP FOR (projects)

    } catch (error) {
        console.error('[Cronjob] Lỗi nghiêm trọng (ngoài vòng lặp):', error.message);
    }
}

/**
 * Chạy luồng Reporting: Thu thập metrics → Lưu snapshot → Render chart → Gửi Telegram
 * @param {string} specificChatId Nếu truyền vào, chỉ chạy cho group đó
 */
async function runReportingJob(specificChatId = null) {
    console.log(`[ReportCron] 📊 Bắt đầu chạy luồng Reporting & Snapshot... (Target: ${specificChatId || 'All'})`);
    try {
        let activeProjects = projectConfig.getAllActiveProjects();
        if (specificChatId) {
            activeProjects = activeProjects.filter(p => p.chatId.toString() === specificChatId.toString());
        }
        if (activeProjects.length === 0) return;

        for (const projectInfo of activeProjects) {
            console.log(`[ReportCron] Đang thu thập metrics cho: ${projectInfo.jiraProjectKey}`);

            const metricsData = await reportOrchestrator.collectMetrics(projectInfo.jiraProjectKey);
            if (!metricsData) {
                console.log(`[ReportCron] Không có data cho ${projectInfo.jiraProjectKey}. Bỏ qua.`);
                continue;
            }

            // 1. Lưu snapshot vào DB
            await reportOrchestrator.saveSnapshot(metricsData);

            // 2. Render Radar Chart (Sức khỏe dự án) + Chi tiết ticket
            try {
                const radarBuffer = await reportOrchestrator.generateRadarChart(metricsData);
                const m = metricsData.metrics;
                const dl = metricsData.detailLists;

                // Build caption with detail
                let caption = `🏥 <b>BÁO CÁO SỨC KHỎE DỰ ÁN</b>\n` +
                    `📌 ${metricsData.sprintName || projectInfo.jiraProjectKey}\n\n` +
                    `📋 Tổng task: ${m.totalTasks} | ✅ Done: ${m.doneTasks}\n` +
                    `⏱ Time Spent: ${(m.totalTimeSpentSeconds / 3600).toFixed(1)}h\n`;

                // Chi tiết Overdue
                if (dl.overdueList.length > 0) {
                    caption += `\n🔥 <b>Overdue (${dl.overdueList.length}):</b>\n`;
                    caption += dl.overdueList.slice(0, 10).map(t => `  • ${t}`).join('\n');
                    if (dl.overdueList.length > 10) caption += `\n  ...và ${dl.overdueList.length - 10} ticket khác`;
                }

                // Chi tiết Blocked
                if (dl.blockedList.length > 0) {
                    caption += `\n\n🚫 <b>Blocked (${dl.blockedList.length}):</b>\n`;
                    caption += dl.blockedList.slice(0, 10).map(t => `  • ${t}`).join('\n');
                    if (dl.blockedList.length > 10) caption += `\n  ...và ${dl.blockedList.length - 10} ticket khác`;
                }

                // Chi tiết Missing Estimation
                if (dl.missingEstList.length > 0) {
                    caption += `\n\n❓ <b>Missing Estimate (${dl.missingEstList.length}):</b>\n`;
                    caption += dl.missingEstList.slice(0, 10).map(t => `  • ${t}`).join('\n');
                    if (dl.missingEstList.length > 10) caption += `\n  ...và ${dl.missingEstList.length - 10} ticket khác`;
                }

                // Chi tiết Unlogged Work
                if (dl.unloggedList.length > 0) {
                    caption += `\n\n⏳ <b>Chưa Log Work (${dl.unloggedList.length}):</b>\n`;
                    caption += dl.unloggedList.slice(0, 10).map(t => `  • ${t}`).join('\n');
                    if (dl.unloggedList.length > 10) caption += `\n  ...và ${dl.unloggedList.length - 10} ticket khác`;
                }

                // Telegram caption limit = 1024 ký tự. Nếu vượt, cắt bớt.
                if (caption.length > 1020) {
                    caption = caption.substring(0, 1017) + '...';
                }

                await telegramService.sendPhoto(radarBuffer, caption, projectInfo.chatId);
                await sleep(1500);
            } catch (chartErr) {
                console.error(`[ReportCron] Lỗi render/gửi Radar Chart:`, chartErr.message);
            }

            // 3. Render Efficiency Bar Chart 
            try {
                if (metricsData.assigneeEfficiency.length > 0) {
                    const barBuffer = await reportOrchestrator.generateEfficiencyChart(metricsData);
                    await telegramService.sendPhoto(barBuffer, `📊 <b>Hiệu suất theo Nhân sự</b> — ${metricsData.sprintName || projectInfo.jiraProjectKey}`, projectInfo.chatId);
                    await sleep(1500);
                }
            } catch (chartErr) {
                console.error(`[ReportCron] Lỗi render/gửi Efficiency Chart:`, chartErr.message);
            }

            // 4. Burndown Chart (nếu đã có historical data)
            try {
                const burndownBuffer = await reportOrchestrator.generateBurndownChart(projectInfo.jiraProjectKey, metricsData.sprintName);
                if (burndownBuffer) {
                    await telegramService.sendPhoto(burndownBuffer, `🔥 <b>Burndown Chart</b> — ${metricsData.sprintName || projectInfo.jiraProjectKey}`, projectInfo.chatId);
                    await sleep(1500);
                }
            } catch (chartErr) {
                console.error(`[ReportCron] Lỗi render/gửi Burndown Chart:`, chartErr.message);
            }

            console.log(`[ReportCron] ✅ Đã hoàn tất báo cáo cho ${projectInfo.jiraProjectKey}`);
        }

        console.log(`[ReportCron] 🎉 Luồng Reporting đã hoàn tất cho tất cả dự án.`);
    } catch (error) {
        console.error('[ReportCron] ❌ Lỗi khi chạy reporting job:', error.message);
    }
}

/**
 * Khởi tạo bộ đếm thời gian
 */
function initCronJobs() {
    console.log('⏳ Đang khởi tạo các luồng Cronjob...');

    // --- Khởi tạo Database nếu có cấu hình ---
    snapshotRepo.init();

    // === CRONJOB 1: Quét cảnh báo (Alert Scan) ===
    let schedule = env.CRON_SCHEDULE || '0 * * * *';
    
    // Loại bỏ dấu ngoặc kép/đơn thừa (lỗi phổ biến khi nhập ENV trên hosting dashboard)
    schedule = schedule.replace(/['"]/g, '').trim();
    
    // Thư viện 'cron' dùng 6 trường (giây phút giờ ngày tháng thứ)
    // Nếu user đang dùng 5 trường (node-cron style), tự động thêm '0' (giây) ở đầu
    let fields = schedule.split(/\s+/);
    if (fields.length === 5) {
        schedule = `0 ${schedule}`;
    }
    console.log(`📅 Lịch Cron Alert sẽ chạy: ${schedule}`);
    
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
        console.log(`✅ Đã đặt lịch quét Alert thành công! Lịch: ${schedule} (Timezone: Asia/Ho_Chi_Minh)`);
    } catch (err) {
        console.error('❌ Lỗi khởi tạo Alert Cron:', err.message);
    }

    // === CRONJOB 2: Reporting & Snapshot ===
    // ⏸ TẠM TẮT: Dùng lệnh /report_now để chạy thủ công cho từng group.
    // Khi muốn bật lại, bỏ comment block bên dưới.
    /*
    let reportSchedule = env.REPORT_CRON_SCHEDULE || '59 23 * * *';
    reportSchedule = reportSchedule.replace(/['"]/g, '').trim();
    let reportFields = reportSchedule.split(/\s+/);
    if (reportFields.length === 5) {
        reportSchedule = `0 ${reportSchedule}`;
    }
    console.log(`📅 Lịch Cron Report sẽ chạy: ${reportSchedule}`);

    try {
        const reportJob = new CronJob(
            reportSchedule,
            async () => {
                console.log(`[ReportCron] Đang thực thi Reporting job theo lịch: ${reportSchedule}`);
                await runReportingJob();
            },
            null,
            true,
            'Asia/Ho_Chi_Minh'
        );
        console.log(`✅ Đã đặt lịch Reporting thành công! Lịch: ${reportSchedule} (Timezone: Asia/Ho_Chi_Minh)`);
    } catch (err) {
        console.error('❌ Lỗi khởi tạo Report Cron:', err.message);
    }
    */
    console.log('⏸ CRONJOB 2 (Reporting) đã tạm tắt. Dùng /report_now để chạy thủ công.');
}

module.exports = {
    initCronJobs,
    runDailyReport,
    runReportingJob
};

