const jiraService = require('./jira.service');
const bottleneckService = require('./bottleneck.service');
const chartService = require('./chart.service');
const snapshotRepo = require('../database/snapshot.repo');

/**
 * Report Orchestrator — Điều phối toàn bộ luồng Reporting
 * 1. Fetch dữ liệu từ Jira (Active Sprint)
 * 2. Tính toán các chỉ số sức khỏe
 * 3. Lưu snapshot vào Database
 * 4. Render biểu đồ trả về Buffer ảnh
 */
class ReportOrchestrator {
    /**
     * Thu thập và tính toán các chỉ số sức khỏe dự án
     * @param {string} projectKey Mã dự án Jira
     * @returns {object} Dữ liệu metrics tổng hợp + mảng issues
     */
    async collectMetrics(projectKey) {
        // JQL: Lấy tất cả Sub-task/Bug trong Active Sprint (không lấy Done/Cancelled để tính remaining)
        const jql = `project = "${projectKey}" AND issuetype NOT IN (Epic, Story, Task) AND sprint IN openSprints() AND sprint NOT IN futureSprints() AND resolution = Unresolved`;

        const data = await jiraService.searchIssues(jql, [
            'summary', 'status', 'assignee', 'duedate',
            'timeoriginalestimate', 'timespent', 'issuetype', 'sprint'
        ]);

        if (!data.issues || data.issues.length === 0) {
            return null;
        }

        const issues = data.issues;
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        let overdueTasks = 0;
        let blockedTasks = 0;
        let missingEst = 0;
        let totalTimeSpentSeconds = 0;
        let totalOriginalEstSeconds = 0;
        let unloggedWorkCount = 0;
        let doneTasks = 0;

        // Chi tiết ticket theo từng nhóm rủi ro
        const overdueList = [];
        const blockedList = [];
        const missingEstList = [];
        const unloggedList = [];

        // Hiệu suất theo Assignee
        const assigneeMap = {};

        // Detect Sprint Info từ issue đầu tiên
        let sprintId = null;
        let sprintName = null;
        if (issues[0]?.fields?.sprint) {
            sprintId = String(issues[0].fields.sprint.id);
            sprintName = issues[0].fields.sprint.name;
        }

        for (const issue of issues) {
            const fields = issue.fields;
            const status = fields.status?.name || 'Unknown';
            const assigneeName = fields.assignee?.displayName || 'Unassigned';

            // Bỏ qua ticket Cancelled
            if (status.toLowerCase() === 'cancelled') continue;

            // Init assignee tracker
            if (!assigneeMap[assigneeName]) {
                assigneeMap[assigneeName] = {
                    name: assigneeName,
                    totalTasks: 0,
                    estimateSeconds: 0,
                    spentSeconds: 0,
                    overdueTasks: 0,
                    reopens: 0
                };
            }
            assigneeMap[assigneeName].totalTasks++;

            // Đếm Overdue
            if (fields.duedate) {
                const dueDate = new Date(fields.duedate);
                dueDate.setHours(0, 0, 0, 0);
                if (today > dueDate) {
                    overdueTasks++;
                    assigneeMap[assigneeName].overdueTasks++;
                    overdueList.push(`${issue.key} (${assigneeName})`);
                }
            }

            // Đếm Blocked
            if (status.toLowerCase().includes('blocked')) {
                blockedTasks++;
                blockedList.push(`${issue.key} (${assigneeName})`);
            }

            // Đếm Done
            const doneStatuses = ['done', 'resolved', 'closed'];
            if (doneStatuses.includes(status.toLowerCase())) {
                doneTasks++;
            }

            // Đếm thiếu Estimation
            if (!fields.timeoriginalestimate) {
                missingEst++;
                missingEstList.push(`${issue.key} (${assigneeName})`);
            }

            // Tổng thời gian
            totalTimeSpentSeconds += fields.timespent || 0;
            totalOriginalEstSeconds += fields.timeoriginalestimate || 0;

            assigneeMap[assigneeName].estimateSeconds += fields.timeoriginalestimate || 0;
            assigneeMap[assigneeName].spentSeconds += fields.timespent || 0;

            // Đếm Unlogged Work
            const activeStatuses = ['in progress', 'doing', 'developing'];
            if (activeStatuses.some(s => status.toLowerCase().includes(s)) && !fields.timespent) {
                unloggedWorkCount++;
                unloggedList.push(`${issue.key} (${assigneeName})`);
            }
        }

        // Build assignee efficiency list
        const assigneeEfficiency = Object.values(assigneeMap).map(a => ({
            name: a.name,
            totalTasks: a.totalTasks,
            estimateHours: parseFloat((a.estimateSeconds / 3600).toFixed(1)),
            spentHours: parseFloat((a.spentSeconds / 3600).toFixed(1)),
            efficiency: a.estimateSeconds > 0
                ? parseFloat(((a.spentSeconds / a.estimateSeconds) * 100).toFixed(1))
                : 0,
            overdueTasks: a.overdueTasks,
            reopens: a.reopens
        }));

        // Đếm lại totalTasks sau khi loại bỏ cancelled
        const activeTasks = issues.filter(i => {
            const s = i.fields.status?.name || '';
            return s.toLowerCase() !== 'cancelled';
        });

        return {
            projectKey,
            sprintId,
            sprintName,
            issues: activeTasks,
            metrics: {
                totalTasks: activeTasks.length,
                doneTasks,
                overdueTasks,
                blockedTasks,
                missingEst,
                unloggedWorkCount,
                totalTimeSpentSeconds,
                totalOriginalEstSeconds
            },
            detailLists: {
                overdueList,
                blockedList,
                missingEstList,
                unloggedList
            },
            assigneeEfficiency
        };
    }

    /**
     * Lưu snapshot vào Database
     */
    async saveSnapshot(metricsData) {
        if (!snapshotRepo.isReady() || !metricsData) return;

        const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

        await snapshotRepo.upsertSnapshot({
            snapshotDate: today,
            projectKey: metricsData.projectKey,
            sprintId: metricsData.sprintId,
            sprintName: metricsData.sprintName,
            totalTasks: metricsData.metrics.totalTasks,
            doneTasks: metricsData.metrics.doneTasks,
            overdueTasks: metricsData.metrics.overdueTasks,
            blockedTasks: metricsData.metrics.blockedTasks,
            missingEst: metricsData.metrics.missingEst,
            totalTimeSpentSeconds: metricsData.metrics.totalTimeSpentSeconds,
            totalOriginalEstSeconds: metricsData.metrics.totalOriginalEstSeconds
        });
    }

    /**
     * Tạo ảnh Radar Chart từ metrics
     * @returns {Buffer} PNG image buffer
     */
    async generateRadarChart(metricsData) {
        const m = metricsData.metrics;
        const total = m.totalTasks || 1;

        const radarData = {
            overdue: Math.min(100, Math.round((m.overdueTasks / total) * 100)),
            blocked: Math.min(100, Math.round((m.blockedTasks / total) * 100)),
            missingInfo: Math.min(100, Math.round((m.missingEst / total) * 100)),
            unloggedWork: Math.min(100, Math.round((m.unloggedWorkCount / total) * 100))
        };

        return await chartService.renderRadarChart(radarData, metricsData.sprintName || metricsData.projectKey);
    }

    /**
     * Tạo ảnh Efficiency Bar Chart
     * @returns {Buffer} PNG image buffer
     */
    async generateEfficiencyChart(metricsData) {
        return await chartService.renderEfficiencyBarChart(
            metricsData.assigneeEfficiency,
            `${metricsData.sprintName || metricsData.projectKey} — Efficiency`
        );
    }

    /**
     * Tạo ảnh Burndown Chart từ historical snapshots
     * @returns {Buffer|null} PNG image buffer hoặc null nếu chưa có data
     */
    async generateBurndownChart(projectKey, sprintName) {
        const snapshots = await snapshotRepo.getSnapshots(projectKey, 30);
        if (snapshots.length < 2) return null;
        return chartService.renderBurndownChart(snapshots, sprintName || projectKey);
    }

    /**
     * Tạo ảnh CFD Chart từ historical snapshots
     * @returns {Buffer|null}
     */
    async generateCFDChart(projectKey) {
        const snapshots = await snapshotRepo.getSnapshots(projectKey, 30);
        if (snapshots.length < 2) return null;
        return chartService.renderCFDChart(snapshots, projectKey);
    }

    /**
     * Chạy luồng Bottleneck Analysis
     * Phân tích changelog cho tất cả issues trong Active Sprint
     */
    async runBottleneckAnalysis(issues) {
        if (!issues || issues.length === 0) return null;

        // Giới hạn 30 issues để tránh quá tải Jira API
        const limitedIssues = issues.slice(0, 30);
        console.log(`[Orchestrator] 🔍 Phân tích bottleneck cho ${limitedIssues.length}/${issues.length} issues...`);

        return bottleneckService.analyzeIssues(limitedIssues);
    }
}

module.exports = new ReportOrchestrator();
