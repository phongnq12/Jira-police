const jiraService = require('./jira.service');

/**
 * Bottleneck Analysis Service
 * Phân tích changelog để tính:
 * 1. Status Aging (tính theo 8h/ngày)
 * 2. Re-open Rate
 * 3. Done Date (từ changelog)
 *
 * Tối ưu: Dùng expand=changelog trong search để lấy changelog cùng lúc,
 * không cần gọi N API calls riêng lẻ.
 */
class BottleneckService {
    /**
     * Chuyển ms → giờ làm việc (8h/ngày)
     */
    _msToWorkingHours(ms) {
        const totalHours = ms / (1000 * 60 * 60);
        const days = Math.floor(totalHours / 24);
        const remainingHours = totalHours % 24;
        const workingHours = (days * 8) + Math.min(remainingHours, 8);
        return parseFloat(workingHours.toFixed(1));
    }

    /**
     * Phân tích changelog (inline) của 1 issue
     * @param {Array} histories Changelog histories (đã có sẵn từ expand=changelog)
     */
    analyzeChangelog(histories = []) {
        const statusAging = {};
        let reopenCount = 0;
        let lastStatusChange = null;
        let doneDate = null;

        const sorted = histories.sort((a, b) => new Date(a.created) - new Date(b.created));

        for (const history of sorted) {
            for (const item of history.items) {
                if (item.field === 'status') {
                    const toStatus = item.toString || 'Unknown';
                    const changeTime = new Date(history.created);

                    if (lastStatusChange) {
                        const durationMs = changeTime - lastStatusChange.time;
                        const workingHours = this._msToWorkingHours(durationMs);
                        if (!statusAging[lastStatusChange.status]) statusAging[lastStatusChange.status] = 0;
                        statusAging[lastStatusChange.status] += workingHours;
                    }

                    // Re-open check
                    const reopenKeywords = ['reopen', 're-open', 'reopened'];
                    if (reopenKeywords.some(kw => toStatus.toLowerCase().includes(kw))) {
                        reopenCount++;
                    }

                    // Done date check
                    const doneKeywords = ['done', 'resolved', 'closed'];
                    if (doneKeywords.some(kw => toStatus.toLowerCase().includes(kw))) {
                        doneDate = changeTime;
                    }

                    lastStatusChange = { status: toStatus, time: changeTime };
                }
            }
        }

        // Tính thời gian ở trạng thái cuối
        if (lastStatusChange) {
            const now = new Date();
            const durationMs = now - lastStatusChange.time;
            const workingHours = this._msToWorkingHours(durationMs);
            if (!statusAging[lastStatusChange.status]) statusAging[lastStatusChange.status] = 0;
            statusAging[lastStatusChange.status] += workingHours;
        }

        for (const key of Object.keys(statusAging)) {
            statusAging[key] = parseFloat(statusAging[key].toFixed(1));
        }

        return { statusAging, reopenCount, doneDate };
    }

    /**
     * Phân tích hàng loạt Issues — dùng inline changelog (không gọi API riêng)
     * Issues PHẢI có changelog.histories (từ expand=changelog trong search)
     */
    async analyzeIssues(issues) {
        const results = [];
        const aggregatedAging = {};
        let totalReopens = 0;

        for (const issue of issues) {
            const status = issue.fields.status?.name || 'Unknown';
            if (status.toLowerCase() === 'cancelled') continue;

            // Lấy changelog trực tiếp từ issue (đã có nhờ expand=changelog)
            const histories = issue.changelog?.histories || [];
            const analysis = this.analyzeChangelog(histories);

            results.push({
                key: issue.key,
                issueType: issue.fields.issuetype?.name || 'Unknown',
                // Standalone ticket (không có parent) → tự trỏ về chính nó
                parentKey: issue.fields.parent?.key || issue.key,
                parentSummary: issue.fields.parent?.fields?.summary || issue.fields.summary,
                summary: issue.fields.summary,
                assignee: issue.fields.assignee?.displayName || 'Unassigned',
                status,
                dueDate: issue.fields.duedate || null,
                originalEstimate: issue.fields.timeoriginalestimate || 0,
                timeSpent: issue.fields.timespent || 0,
                doneDate: analysis.doneDate,
                ...analysis
            });

            for (const [s, hours] of Object.entries(analysis.statusAging)) {
                if (!aggregatedAging[s]) aggregatedAging[s] = { totalHours: 0, count: 0 };
                aggregatedAging[s].totalHours += hours;
                aggregatedAging[s].count++;
            }
            totalReopens += analysis.reopenCount;
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
