const axios = require('axios');

const QUICKCHART_URL = 'https://quickchart.io/chart';

/**
 * Chart Service — Render biểu đồ qua QuickChart.io API
 * Gửi Chart.js config → nhận ảnh PNG chất lượng browser.
 * Không cần cài canvas hay chart.js local.
 */
class ChartService {
    /**
     * Gọi QuickChart API để render chart thành PNG Buffer
     * @param {object} chartConfig Chart.js configuration object
     * @param {number} width Chiều rộng ảnh (px)
     * @param {number} height Chiều cao ảnh (px)
     * @returns {Buffer} PNG image buffer
     */
    async _renderChart(chartConfig, width = 800, height = 500) {
        const payload = {
            chart: JSON.stringify(chartConfig),
            width,
            height,
            backgroundColor: '#1e293b',
            format: 'png',
            devicePixelRatio: 2
        };

        const response = await axios.post(QUICKCHART_URL, payload, {
            responseType: 'arraybuffer',
            timeout: 15000
        });

        return Buffer.from(response.data);
    }

    /**
     * Tạo Radar Chart — Đánh giá sức khỏe dự án theo 4 chỉ số
     * @param {object} data { overdue, blocked, missingInfo, unloggedWork } (giá trị 0-100 %)
     * @param {string} projectName Tên dự án hiển thị trên chart
     * @returns {Buffer} PNG image buffer
     */
    async renderRadarChart(data, projectName = 'Project Health') {
        const config = {
            type: 'radar',
            data: {
                labels: ['Overdue %', 'Blocked %', 'Missing Est %', 'Unlogged Work %'],
                datasets: [{
                    label: projectName,
                    data: [
                        data.overdue || 0,
                        data.blocked || 0,
                        data.missingInfo || 0,
                        data.unloggedWork || 0
                    ],
                    backgroundColor: 'rgba(255, 99, 132, 0.25)',
                    borderColor: 'rgba(255, 99, 132, 1)',
                    borderWidth: 3,
                    pointBackgroundColor: 'rgba(255, 99, 132, 1)',
                    pointRadius: 6
                }]
            },
            options: {
                plugins: {
                    title: {
                        display: true,
                        text: `Health Radar — ${projectName}`,
                        color: '#ffffff',
                        font: { size: 20, weight: 'bold' }
                    },
                    legend: {
                        labels: { color: '#ffffff', font: { size: 14 } }
                    },
                    datalabels: {
                        color: '#ffffff',
                        font: { size: 14, weight: 'bold' },
                        formatter: (value) => value + '%'
                    }
                },
                scales: {
                    r: {
                        min: 0,
                        max: 100,
                        ticks: {
                            stepSize: 20,
                            color: '#94a3b8',
                            backdropColor: 'transparent',
                            font: { size: 12 }
                        },
                        grid: { color: 'rgba(148, 163, 184, 0.3)' },
                        angleLines: { color: 'rgba(148, 163, 184, 0.3)' },
                        pointLabels: {
                            color: '#e2e8f0',
                            font: { size: 14, weight: 'bold' }
                        }
                    }
                }
            }
        };

        return this._renderChart(config, 600, 600);
    }

    /**
     * Tạo Bar Chart — So sánh Original Estimate vs Time Spent theo Assignee
     * @param {Array} assigneeData [{ name, estimateHours, spentHours }]
     * @param {string} title
     * @returns {Buffer} PNG image buffer
     */
    async renderEfficiencyBarChart(assigneeData, title = 'Estimate vs Actual') {
        const labels = assigneeData.map(d => d.name.length > 18 ? d.name.substring(0, 18) + '…' : d.name);

        const config = {
            type: 'bar',
            data: {
                labels,
                datasets: [
                    {
                        label: 'Original Estimate (h)',
                        data: assigneeData.map(d => d.estimateHours),
                        backgroundColor: 'rgba(59, 130, 246, 0.8)',
                        borderColor: 'rgba(59, 130, 246, 1)',
                        borderWidth: 1
                    },
                    {
                        label: 'Time Spent (h)',
                        data: assigneeData.map(d => d.spentHours),
                        backgroundColor: 'rgba(251, 146, 60, 0.8)',
                        borderColor: 'rgba(251, 146, 60, 1)',
                        borderWidth: 1
                    }
                ]
            },
            options: {
                plugins: {
                    title: {
                        display: true,
                        text: title,
                        color: '#ffffff',
                        font: { size: 18, weight: 'bold' }
                    },
                    legend: {
                        labels: { color: '#ffffff', font: { size: 13 } }
                    },
                    datalabels: {
                        color: '#ffffff',
                        anchor: 'end',
                        align: 'top',
                        font: { size: 12, weight: 'bold' },
                        formatter: (value) => value > 0 ? value + 'h' : ''
                    }
                },
                scales: {
                    x: {
                        ticks: { color: '#e2e8f0', font: { size: 13, weight: 'bold' } },
                        grid: { color: 'rgba(148, 163, 184, 0.15)' }
                    },
                    y: {
                        beginAtZero: true,
                        ticks: { color: '#e2e8f0', font: { size: 12 } },
                        grid: { color: 'rgba(148, 163, 184, 0.2)' },
                        title: { display: true, text: 'Hours', color: '#94a3b8', font: { size: 14 } }
                    }
                }
            }
        };

        return this._renderChart(config, 800, 500);
    }

    /**
     * Tạo Cumulative Flow Diagram (CFD)
     * @param {Array} snapshots Mảng snapshots từ DB
     * @param {string} projectName
     * @returns {Buffer} PNG image buffer
     */
    async renderCFDChart(snapshots, projectName = 'Project') {
        const labels = snapshots.map(s => {
            const d = new Date(s.snapshot_date);
            return `${d.getDate()}/${d.getMonth() + 1}`;
        });

        const config = {
            type: 'line',
            data: {
                labels,
                datasets: [
                    {
                        label: 'Done',
                        data: snapshots.map(s => s.done_tasks),
                        backgroundColor: 'rgba(34, 197, 94, 0.3)',
                        borderColor: 'rgba(34, 197, 94, 1)',
                        fill: true, tension: 0.3, borderWidth: 3
                    },
                    {
                        label: 'Blocked',
                        data: snapshots.map(s => s.blocked_tasks),
                        backgroundColor: 'rgba(239, 68, 68, 0.3)',
                        borderColor: 'rgba(239, 68, 68, 1)',
                        fill: true, tension: 0.3, borderWidth: 3
                    },
                    {
                        label: 'Overdue',
                        data: snapshots.map(s => s.overdue_tasks),
                        backgroundColor: 'rgba(234, 179, 8, 0.3)',
                        borderColor: 'rgba(234, 179, 8, 1)',
                        fill: true, tension: 0.3, borderWidth: 3
                    },
                    {
                        label: 'Total Tasks',
                        data: snapshots.map(s => s.total_tasks),
                        backgroundColor: 'rgba(139, 92, 246, 0.15)',
                        borderColor: 'rgba(139, 92, 246, 1)',
                        fill: true, tension: 0.3, borderWidth: 2, borderDash: [8, 4]
                    }
                ]
            },
            options: {
                plugins: {
                    title: {
                        display: true,
                        text: `Cumulative Flow — ${projectName}`,
                        color: '#ffffff',
                        font: { size: 18, weight: 'bold' }
                    },
                    legend: {
                        labels: { color: '#ffffff', font: { size: 13 } }
                    }
                },
                scales: {
                    x: {
                        ticks: { color: '#e2e8f0', font: { size: 12 }, maxRotation: 45 },
                        grid: { color: 'rgba(148, 163, 184, 0.15)' }
                    },
                    y: {
                        beginAtZero: true, stacked: false,
                        ticks: { color: '#e2e8f0', font: { size: 12 } },
                        grid: { color: 'rgba(148, 163, 184, 0.2)' },
                        title: { display: true, text: 'Tasks', color: '#94a3b8', font: { size: 14 } }
                    }
                }
            }
        };

        return this._renderChart(config, 800, 500);
    }

    /**
     * Tạo Burndown Chart — Theo dõi tiến độ Sprint
     * @param {Array} snapshots Mảng snapshots từ DB
     * @param {string} sprintName
     * @returns {Buffer} PNG image buffer
     */
    async renderBurndownChart(snapshots, sprintName = 'Sprint') {
        const labels = snapshots.map(s => {
            const d = new Date(s.snapshot_date);
            return `${d.getDate()}/${d.getMonth() + 1}`;
        });

        const remainingData = snapshots.map(s => s.total_tasks - s.done_tasks);
        const totalStart = remainingData[0] || 0;
        const idealData = snapshots.map((_, i) => {
            return parseFloat(Math.max(0, totalStart - (totalStart / (snapshots.length - 1)) * i).toFixed(1));
        });

        const config = {
            type: 'line',
            data: {
                labels,
                datasets: [
                    {
                        label: 'Remaining Tasks',
                        data: remainingData,
                        borderColor: 'rgba(239, 68, 68, 1)',
                        backgroundColor: 'rgba(239, 68, 68, 0.15)',
                        borderWidth: 3,
                        fill: true, tension: 0.2,
                        pointRadius: 5,
                        pointBackgroundColor: 'rgba(239, 68, 68, 1)'
                    },
                    {
                        label: 'Ideal Burndown',
                        data: idealData,
                        borderColor: 'rgba(34, 197, 94, 0.8)',
                        borderWidth: 2,
                        borderDash: [10, 5],
                        fill: false, tension: 0, pointRadius: 0
                    }
                ]
            },
            options: {
                plugins: {
                    title: {
                        display: true,
                        text: `Burndown — ${sprintName}`,
                        color: '#ffffff',
                        font: { size: 18, weight: 'bold' }
                    },
                    legend: {
                        labels: { color: '#ffffff', font: { size: 13 } }
                    },
                    datalabels: {
                        display: (ctx) => ctx.datasetIndex === 0,
                        color: '#ffffff',
                        font: { size: 12, weight: 'bold' },
                        anchor: 'end',
                        align: 'top'
                    }
                },
                scales: {
                    x: {
                        ticks: { color: '#e2e8f0', font: { size: 12 } },
                        grid: { color: 'rgba(148, 163, 184, 0.15)' }
                    },
                    y: {
                        beginAtZero: true,
                        ticks: { color: '#e2e8f0', font: { size: 12 } },
                        grid: { color: 'rgba(148, 163, 184, 0.2)' },
                        title: { display: true, text: 'Tasks Remaining', color: '#94a3b8', font: { size: 14 } }
                    }
                }
            }
        };

        return this._renderChart(config, 800, 500);
    }
}

module.exports = new ChartService();
