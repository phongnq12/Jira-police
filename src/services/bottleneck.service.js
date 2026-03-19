const jiraService = require('./jira.service');

/**
 * Bottleneck Analysis Service
 * Phân tích changelog của Issue để tính:
 * 1. Status Aging: Thời gian mỗi task ngâm ở từng trạng thái (tính theo 8h/ngày)
 * 2. Re-open Rate: Số lần task quay ngược từ Testing/Review → Reopen
 * 3. Done Date: Thời điểm ticket được kéo sang Done
 */
class BottleneckService {
    /**
     * Lấy changelog của 1 Issue từ Jira API
     */
    async getIssueChangelog(issueKey) {
        try {
            const response = await jiraService._axiosInstance.get(`/issue/${issueKey}`, {
                params: {
                    expand: 'changelog',
                    fields: 'status,summary,assignee'
                }
            });
            return response.data.changelog?.histories || [];
        } catch (error) {
            console.error(`[Bottleneck] ❌ Không thể lấy changelog cho ${issueKey}:`, error.message);
            return [];
        }
    }

    /**
     * Chuyển đổi milliseconds → giờ làm việc (8h/ngày)
     * VD: 24h thực tế = 1 ngày = 8h làm việc
     */
    _msToWorkingHours(ms) {
        const totalHours = ms / (1000 * 60 * 60);
        const days = Math.floor(totalHours / 24);
        const remainingHours = totalHours % 24;
        // Mỗi ngày = 8h, giờ lẻ giữ nguyên (coi như trong ngày)
        const workingHours = (days * 8) + Math.min(remainingHours, 8);
        return parseFloat(workingHours.toFixed(1));
    }

    /**
     * Phân tích Status Aging + Done Date cho 1 Issue
     */
    async analyzeIssue(issueKey) {
        const histories = await this.getIssueChangelog(issueKey);

        const statusAging = {};
        let reopenCount = 0;
        let lastStatusChange = null;
        let doneDate = null;

        const sortedHistories = histories.sort((a, b) => new Date(a.created) - new Date(b.created));

        for (const history of sortedHistories) {
            for (const item of history.items) {
                if (item.field === 'status') {
                    const toStatus = item.toString || 'Unknown';
                    const changeTime = new Date(history.created);

                    // Tính thời gian ngâm ở trạng thái trước
                    if (lastStatusChange) {
                        const durationMs = changeTime - lastStatusChange.time;
                        const workingHours = this._msToWorkingHours(durationMs);

                        if (!statusAging[lastStatusChange.status]) {
                            statusAging[lastStatusChange.status] = 0;
                        }
                        statusAging[lastStatusChange.status] += workingHours;
                    }

                    // Kiểm tra Re-open
                    const reopenKeywords = ['reopen', 're-open', 'reopened'];
                    if (reopenKeywords.some(kw => toStatus.toLowerCase().includes(kw))) {
                        reopenCount++;
                    }

                    // Kiểm tra Done Date
                    const doneKeywords = ['done', 'resolved', 'closed'];
                    if (doneKeywords.some(kw => toStatus.toLowerCase().includes(kw))) {
                        doneDate = changeTime;
                    }

                    lastStatusChange = { status: toStatus, time: changeTime };
                }
            }
        }

        // Tính thời gian ở trạng thái cuối cùng (từ lần đổi cuối đến hiện tại)
        if (lastStatusChange) {
            const now = new Date();
            const durationMs = now - lastStatusChange.time;
            const workingHours = this._msToWorkingHours(durationMs);

            if (!statusAging[lastStatusChange.status]) {
                statusAging[lastStatusChange.status] = 0;
            }
            statusAging[lastStatusChange.status] += workingHours;
        }

        // Làm tròn
        for (const key of Object.keys(statusAging)) {
            statusAging[key] = parseFloat(statusAging[key].toFixed(1));
        }

        return { statusAging, reopenCount, doneDate };
    }

    /**
     * Phân tích hàng loạt Issues (Batch)
     */
    async analyzeIssues(issues) {
        const results = [];
        const aggregatedAging = {};
        let totalReopens = 0;

        for (let i = 0; i < issues.length; i++) {
            const issue = issues[i];
            const key = issue.key;
            const status = issue.fields.status?.name || 'Unknown';

            if (status.toLowerCase() === 'cancelled') {
                console.log(`[Bottleneck] ⏭ Bỏ qua ${key} (Cancelled)`);
                continue;
            }

            console.log(`[Bottleneck] Đang phân tích ${i + 1}/${issues.length}: ${key}`);

            const analysis = await this.analyzeIssue(key);

            results.push({
                key,
                parentKey: issue.fields.parent?.key || '-',
                parentSummary: issue.fields.parent?.fields?.summary || '-',
                summary: issue.fields.summary,
                assignee: issue.fields.assignee?.displayName || 'Unassigned',
                status,
                dueDate: issue.fields.duedate || null,
                originalEstimate: issue.fields.timeoriginalestimate || 0,
                timeSpent: issue.fields.timespent || 0,
                doneDate: analysis.doneDate,
                ...analysis
            });

            // Gom status aging tổng hợp
            for (const [s, hours] of Object.entries(analysis.statusAging)) {
                if (!aggregatedAging[s]) aggregatedAging[s] = { totalHours: 0, count: 0 };
                aggregatedAging[s].totalHours += hours;
                aggregatedAging[s].count++;
            }
            totalReopens += analysis.reopenCount;

            // Sleep 500ms giữa các request
            if (i < issues.length - 1) {
                await new Promise(r => setTimeout(r, 500));
            }
        }

        // Tính trung bình aging
        const avgAging = {};
        let bottleneckStatus = null;
        let maxAvgHours = 0;

        for (const [s, data] of Object.entries(aggregatedAging)) {
            const avg = parseFloat((data.totalHours / data.count).toFixed(1));
            avgAging[s] = avg;
            if (avg > maxAvgHours) {
                maxAvgHours = avg;
                bottleneckStatus = s;
            }
        }

        return {
            issueAnalysis: results,
            summary: {
                totalIssues: issues.length,
                averageStatusAging: avgAging,
                totalReopens,
                bottleneckStatus,
                bottleneckAvgHours: maxAvgHours
            }
        };
    }
}

module.exports = new BottleneckService();
