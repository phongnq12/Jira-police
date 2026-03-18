const jiraService = require('./jira.service');

/**
 * Bottleneck Analysis Service
 * Phân tích changelog của Issue để tính:
 * 1. Status Aging: Thời gian mỗi task ngâm ở từng trạng thái
 * 2. Re-open Rate: Số lần task quay ngược từ Testing/Review → Reopen
 */
class BottleneckService {
    /**
     * Lấy changelog của 1 Issue từ Jira API
     * @param {string} issueKey VD: 'PROJ-123'
     * @returns {Array} Danh sách changelog entries
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
     * Phân tích Status Aging cho 1 Issue
     * Trả về object { statusName: durationInHours }
     * @param {string} issueKey
     * @returns {object} { statusAging: {...}, reopenCount: number }
     */
    async analyzeIssue(issueKey) {
        const histories = await this.getIssueChangelog(issueKey);

        const statusAging = {};
        let reopenCount = 0;
        let lastStatusChange = null;

        // Sắp xếp theo thời gian tạo (cũ nhất trước)
        const sortedHistories = histories.sort((a, b) => new Date(a.created) - new Date(b.created));

        for (const history of sortedHistories) {
            for (const item of history.items) {
                if (item.field === 'status') {
                    const fromStatus = item.fromString || 'Unknown';
                    const toStatus = item.toString || 'Unknown';
                    const changeTime = new Date(history.created);

                    // Tính thời gian ngâm ở trạng thái trước
                    if (lastStatusChange) {
                        const durationMs = changeTime - lastStatusChange.time;
                        const durationHours = durationMs / (1000 * 60 * 60);

                        if (!statusAging[lastStatusChange.status]) {
                            statusAging[lastStatusChange.status] = 0;
                        }
                        statusAging[lastStatusChange.status] += durationHours;
                    }

                    // Kiểm tra Re-open (status quay ngược về Reopen)
                    const reopenKeywords = ['reopen', 're-open', 'reopened'];
                    if (reopenKeywords.some(kw => toStatus.toLowerCase().includes(kw))) {
                        reopenCount++;
                    }

                    lastStatusChange = { status: toStatus, time: changeTime };
                }
            }
        }

        // Tính thời gian ở trạng thái cuối cùng (từ lần đổi cuối đến hiện tại)
        if (lastStatusChange) {
            const now = new Date();
            const durationMs = now - lastStatusChange.time;
            const durationHours = durationMs / (1000 * 60 * 60);

            if (!statusAging[lastStatusChange.status]) {
                statusAging[lastStatusChange.status] = 0;
            }
            statusAging[lastStatusChange.status] += durationHours;
        }

        // Làm tròn giá trị
        for (const key of Object.keys(statusAging)) {
            statusAging[key] = parseFloat(statusAging[key].toFixed(1));
        }

        return { statusAging, reopenCount };
    }

    /**
     * Phân tích hàng loạt Issues (Batch)
     * Có sleep delay giữa các request để tránh Rate Limit
     * @param {Array} issues Mảng Issues từ Jira search
     * @returns {object} { issueAnalysis: [...], summary: { avgAging, totalReopens, bottleneckStatus } }
     */
    async analyzeIssues(issues) {
        const results = [];
        const aggregatedAging = {};
        let totalReopens = 0;

        for (let i = 0; i < issues.length; i++) {
            const issue = issues[i];
            const key = issue.key;
            const status = issue.fields.status?.name || 'Unknown';

            // Bỏ qua ticket Cancelled
            if (status.toLowerCase() === 'cancelled') {
                console.log(`[Bottleneck] ⏭ Bỏ qua ${key} (Cancelled)`);
                continue;
            }

            console.log(`[Bottleneck] Đang phân tích ${i + 1}/${issues.length}: ${key}`);

            const analysis = await this.analyzeIssue(key);

            results.push({
                key,
                summary: issue.fields.summary,
                assignee: issue.fields.assignee?.displayName || 'Unassigned',
                status: issue.fields.status?.name || 'Unknown',
                ...analysis
            });

            // Gom status aging tổng hợp
            for (const [status, hours] of Object.entries(analysis.statusAging)) {
                if (!aggregatedAging[status]) aggregatedAging[status] = { totalHours: 0, count: 0 };
                aggregatedAging[status].totalHours += hours;
                aggregatedAging[status].count++;
            }
            totalReopens += analysis.reopenCount;

            // Sleep 500ms giữa các request để nhẹ nhàng với Jira
            if (i < issues.length - 1) {
                await new Promise(r => setTimeout(r, 500));
            }
        }

        // Tính trung bình aging & xác định trạng thái nghẽn nhất
        const avgAging = {};
        let bottleneckStatus = null;
        let maxAvgHours = 0;

        for (const [status, data] of Object.entries(aggregatedAging)) {
            const avg = parseFloat((data.totalHours / data.count).toFixed(1));
            avgAging[status] = avg;
            if (avg > maxAvgHours) {
                maxAvgHours = avg;
                bottleneckStatus = status;
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
