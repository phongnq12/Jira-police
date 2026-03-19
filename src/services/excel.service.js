const ExcelJS = require('exceljs');

/**
 * Excel Service — Tạo file Excel báo cáo chi tiết
 * Sử dụng thư viện ExcelJS cho Node.js
 */
class ExcelService {
    /**
     * Tạo file Excel báo cáo Bottleneck + Hiệu suất cá nhân
     * @param {object} reportData Bao gồm: issues (danh sách task), bottleneck (phân tích), assigneeEfficiency (hiệu suất)
     * @param {string} projectName
     * @returns {Buffer} File Excel dưới dạng Buffer
     */
    async generateReport(reportData, projectName = 'Project') {
        const workbook = new ExcelJS.Workbook();
        workbook.creator = 'Jira Master Bot';
        workbook.created = new Date();

        // ============================
        // Sheet 1: Danh sách Task nghẽn
        // ============================
        const bottleneckSheet = workbook.addWorksheet('Bottleneck Tasks', {
            properties: { tabColor: { argb: 'FFD32F2F' } }
        });

        bottleneckSheet.columns = [
            { header: 'Issue Key', key: 'key', width: 15 },
            { header: 'Summary', key: 'summary', width: 40 },
            { header: 'Status', key: 'status', width: 18 },
            { header: 'Assignee', key: 'assignee', width: 22 },
            { header: 'Bottleneck Status', key: 'bottleneckStatus', width: 20 },
            { header: 'Aging (h)', key: 'agingHours', width: 12 },
            { header: 'Re-open Count', key: 'reopenCount', width: 14 }
        ];

        // Style header row
        this._styleHeaderRow(bottleneckSheet);

        // Thêm data
        if (reportData.bottleneck?.issueAnalysis) {
            for (const item of reportData.bottleneck.issueAnalysis) {
                // Tìm status ngâm lâu nhất
                let maxStatus = '-';
                let maxHours = 0;
                for (const [status, hours] of Object.entries(item.statusAging)) {
                    if (hours > maxHours) {
                        maxHours = hours;
                        maxStatus = status;
                    }
                }

                bottleneckSheet.addRow({
                    key: item.key,
                    summary: item.summary,
                    status: item.status,
                    assignee: item.assignee,
                    bottleneckStatus: maxStatus,
                    agingHours: maxHours,
                    reopenCount: item.reopenCount
                });
            }
        }

        // Auto filter
        bottleneckSheet.autoFilter = 'A1:G1';

        // Đóng khung viền cho toàn bộ data
        this._addBorders(bottleneckSheet);

        // ====================================
        // Sheet 2: Hiệu suất theo Assignee
        // ====================================
        const efficiencySheet = workbook.addWorksheet('Assignee Efficiency', {
            properties: { tabColor: { argb: 'FF1976D2' } }
        });

        efficiencySheet.columns = [
            { header: 'Assignee', key: 'name', width: 25 },
            { header: 'Total Tasks', key: 'totalTasks', width: 14 },
            { header: 'Estimate (h)', key: 'estimateHours', width: 14 },
            { header: 'Spent (h)', key: 'spentHours', width: 14 },
            { header: 'Efficiency %', key: 'efficiency', width: 14 },
            { header: 'Overdue Tasks', key: 'overdueTasks', width: 14 },
            { header: 'Overdue Tickets', key: 'overdueTickets', width: 40 },
            { header: 'Re-opens', key: 'reopens', width: 12 }
        ];

        this._styleHeaderRow(efficiencySheet);

        if (reportData.assigneeEfficiency) {
            for (const item of reportData.assigneeEfficiency) {
                const overdueTicketStr = (item.overdueTickets || []).join(', ');

                const row = efficiencySheet.addRow({
                    name: item.name,
                    totalTasks: item.totalTasks,
                    estimateHours: item.estimateHours,
                    spentHours: item.spentHours,
                    efficiency: item.efficiency,
                    overdueTasks: item.overdueTasks || 0,
                    overdueTickets: overdueTicketStr,
                    reopens: item.reopens || 0
                });

                // Highlight nếu efficiency > 120% (làm lố)
                if (item.efficiency > 120) {
                    row.getCell('efficiency').fill = {
                        type: 'pattern',
                        pattern: 'solid',
                        fgColor: { argb: 'FFFFF3E0' }
                    };
                }

                // Highlight overdue tickets bằng đỏ nhạt
                if (overdueTicketStr) {
                    row.getCell('overdueTickets').fill = {
                        type: 'pattern',
                        pattern: 'solid',
                        fgColor: { argb: 'FFFFEBEE' }
                    };
                    row.getCell('overdueTickets').font = { color: { argb: 'FFD32F2F' } };
                }
            }
        }

        efficiencySheet.autoFilter = 'A1:H1';
        this._addBorders(efficiencySheet);

        // ========================================
        // Sheet 3: Tổng hợp sức khỏe dự án
        // ========================================
        const summarySheet = workbook.addWorksheet('Project Summary', {
            properties: { tabColor: { argb: 'FF388E3C' } }
        });

        summarySheet.columns = [
            { header: 'Metric', key: 'metric', width: 30 },
            { header: 'Value', key: 'value', width: 20 }
        ];

        this._styleHeaderRow(summarySheet);

        const summary = reportData.summary || {};
        summarySheet.addRow({ metric: 'Project', value: projectName });
        summarySheet.addRow({ metric: 'Report Date', value: new Date().toLocaleDateString('vi-VN') });
        summarySheet.addRow({ metric: 'Total Tasks (Active Sprint)', value: summary.totalTasks || 0 });
        summarySheet.addRow({ metric: 'Overdue Tasks', value: summary.overdueTasks || 0 });
        summarySheet.addRow({ metric: 'Blocked Tasks', value: summary.blockedTasks || 0 });
        summarySheet.addRow({ metric: 'Missing Estimation', value: summary.missingEst || 0 });
        summarySheet.addRow({ metric: 'Total Time Spent (h)', value: summary.totalTimeSpentHours || 0 });
        summarySheet.addRow({ metric: 'Bottleneck Status', value: summary.bottleneckStatus || 'N/A' });
        summarySheet.addRow({ metric: 'Total Re-opens', value: summary.totalReopens || 0 });

        this._addBorders(summarySheet);

        // Xuất Buffer
        const buffer = await workbook.xlsx.writeBuffer();
        return buffer;
    }

    /**
     * Style Header Row chung cho mọi Sheet
     */
    _styleHeaderRow(worksheet) {
        const headerRow = worksheet.getRow(1);
        headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
        headerRow.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FF2C3E50' }
        };
        headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
        headerRow.height = 28;
    }

    /**
     * Thêm border cho toàn bộ vùng dữ liệu
     */
    _addBorders(worksheet) {
        const thinBorder = {
            top: { style: 'thin' },
            left: { style: 'thin' },
            bottom: { style: 'thin' },
            right: { style: 'thin' }
        };

        worksheet.eachRow((row) => {
            row.eachCell((cell) => {
                cell.border = thinBorder;
            });
        });
    }
}

module.exports = new ExcelService();
