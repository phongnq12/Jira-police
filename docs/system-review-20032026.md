# 🔍 System Review — Jira Master Bot

> **Review Date:** 20/03/2026  
> **Reviewer:** AI Agent (Antigravity)  
> **Codebase:** `jira-master-bot/src/` (~2,200 LOC)  
> **Test Coverage:** 26 tests (sanitize + bottleneck)

---

## 📁 Kiến Trúc Hệ Thống

```
jira-master-bot/
├── src/
│   ├── index.js                          # Entry point (Express + Telegram Bot)
│   ├── config/
│   │   ├── env.js                        # Biến môi trường
│   │   └── projects.js                   # Routing: Telegram Group → Jira Project
│   ├── controllers/
│   │   ├── command.controller.js         # Xử lý lệnh Telegram (/check_effort, /export_report,...)
│   │   ├── cron.controller.js            # Cronjob: Alert scan + Reporting
│   │   └── webhook.controller.js         # Nhận webhook từ Jira (real-time)
│   ├── services/
│   │   ├── jira.service.js               # Giao tiếp Jira REST API (pagination + retry)
│   │   ├── telegram.service.js           # Gửi tin nhắn/ảnh/file qua Telegram API
│   │   ├── report_orchestrator.service.js # Thu thập metrics + tính toán hiệu suất
│   │   ├── bottleneck.service.js         # Phân tích changelog (aging, re-open, done date)
│   │   ├── chart.service.js              # Render biểu đồ (QuickChart.io API)
│   │   ├── excel.service.js              # Tạo file Excel report (ExcelJS)
│   │   ├── message.service.js            # Format tin nhắn cảnh báo
│   │   ├── notification.service.js       # Dispatch alert (Telegram/Teams)
│   │   └── storage.service.js            # Lưu trữ JSON (mute sprint,...)
│   ├── database/
│   │   └── snapshot.repo.js              # PostgreSQL: Lưu snapshot sức khỏe dự án
│   └── utils/
│       └── sanitize.js                   # Sanitize input chống JQL Injection
├── tests/
│   ├── sanitize.test.js                  # 14 tests — JQL sanitization
│   └── bottleneck.test.js                # 12 tests — Bottleneck analysis
└── package.json
```

---

## 🤖 Chức Năng & Lệnh

| Lệnh | Trạng thái | Mô tả |
|-------|-----------|-------|
| `/check_effort [sprint_id]` | ✅ Active | Báo cáo effort theo assignee (Original Estimate) |
| `/check_remaining_tasks [name]` | ✅ Active | Danh sách task chưa xong + Remaining Estimate |
| `/export_report` | ✅ Active | Xuất Excel 3 sheet: Task Analysis, Assignee Efficiency, Summary |
| `/scan_all` | ✅ Active | Quét cảnh báo toàn bộ dự án (không giới hạn sprint) |
| `/mute_sprint [id]` | ✅ Active | Tắt cảnh báo cho sprint cụ thể |
| `/unmute_sprint [id]` | ✅ Active | Bật lại cảnh báo |
| `/report_now` | ⏸ Disabled | Biểu đồ đang tối ưu, hiện thông báo tạm ngưng |
| Cronjob Alert | ✅ Active | Quét cảnh báo theo lịch (CRON_SCHEDULE) |
| Cronjob Report | ⏸ Disabled | Báo cáo biểu đồ tự động (đã comment out) |
| Jira Webhook | ✅ Active | Real-time: Blocked alert, Due date change, Done without log work |

---

## 📊 Excel Report — Cấu Trúc Hiện Tại

### Sheet 1: Task Analysis

| Cột | Nguồn | Ghi chú |
|-----|-------|---------|
| Issue Key | `issue.key` | |
| Parent Key | `issue.fields.parent.key` | Story/Task cha |
| Summary | `issue.fields.summary` | |
| Status | `issue.fields.status.name` | Trạng thái hiện tại |
| Assignee | `issue.fields.assignee.displayName` | |
| Due Date | `issue.fields.duedate` | Format dd/mm/yyyy |
| Done Date | Changelog | Thời điểm kéo Done (từ `expand=changelog`) |
| Overdue | Tính toán | Yes/No — highlight đỏ nếu Yes |
| Estimate (h) | `timeoriginalestimate / 3600` | Original Estimate |
| Spent (h) | `timespent / 3600` | Time Spent |
| Re-open | Changelog | Số lần quay về Reopen |

### Sheet 2: Assignee Efficiency

| Cột | Ghi chú |
|-----|---------|
| Assignee | Tên nhân sự |
| Total Tasks | Tổng task (bao gồm Done, loại trừ Cancelled) |
| Estimate (h) | Tổng Original Estimate |
| Spent (h) | Tổng Time Spent |
| Efficiency % | `(Spent / Estimate) × 100` |
| Overdue Tasks | Số task overdue |
| Overdue Tickets | Danh sách ticket ID (highlight đỏ) |
| Re-opens | Tổng số lần re-open |

### Sheet 3: Project Summary

| Cột | Ghi chú |
|-----|---------|
| Metric | Tên chỉ số |
| Value | Giá trị |

---

## 🔐 Nghiệp Vụ Overdue

Logic 3 tầng (đã fix ngày 19-20/03/2026):

```
✅ Done đúng/trước hạn     → Không overdue
⚠️ Done SAU hạn            → Overdue (resolutiondate > duedate)
🔥 Chưa Done + quá hạn     → Overdue (today > duedate)
```

- Sử dụng field `resolutiondate` từ Jira API
- Cancelled tickets luôn bị loại khỏi mọi tính toán

---

## ✅ Các Vấn Đề Đã Fix (20/03/2026)

| ID | Vấn đề | Fix |
|----|--------|-----|
| S1+S2 | **JQL Injection** — user input nối thẳng vào JQL | Tạo `sanitize.js`: `sanitizeJqlString()` + `sanitizeSprintId()` |
| B1 | **Cron Alert dùng `resolution = Unresolved`** | Bỏ filter → lấy cả Done tasks |
| P1 | **Bottleneck analysis: N API calls tuần tự** (25s cho 50 ticket) | Dùng `expand=changelog` trong search → 1 request (~2s) |
| C2 | **Không có unit test** | Thêm Jest + 26 tests |

---

## ⚠️ Các Vấn Đề Còn Tồn Đọng

### Mức độ Medium 🟡

| ID | Vấn đề | File | Gợi ý Fix |
|----|--------|------|-----------|
| C1 | Command router dùng `if` chain | `command.controller.js` | Refactor thành command pattern / map |
| C3 | `exemptParentTypes` khai báo lặp 5 lần | Nhiều file | Extract thành shared constant |
| C4 | `cron.controller.js` quá dài (440 dòng) | `cron.controller.js` | Tách `alert.controller.js` + `report.controller.js` |
| C5 | `doneStatuses` khai báo lặp 4+ lần | Nhiều file | Shared constant |
| S3 | SSL `rejectUnauthorized: false` | `snapshot.repo.js` | Cấu hình đúng CA cert cho Render PostgreSQL |
| S4 | Fake User-Agent trong Jira service | `jira.service.js` | Đổi thành `Jira-Master-Bot/1.0` |
| S6 | Không có rate limiting trên Express | `index.js` | Thêm `express-rate-limit` |
| P2 | QuickChart.io không cache | `chart.service.js` | Cache chart buffer nếu data không đổi |
| P3 | Alert cron gửi tuần tự (1s sleep/msg) | `cron.controller.js` | Batch messages |
| B2 | Webhook chỉ gửi group đầu tiên | `webhook.controller.js` | Gửi tất cả group cùng project |

### Mức độ Low 🟢

| ID | Vấn đề | File |
|----|--------|------|
| C6 | Console.log "tin nhắn rác" cho mọi message | `command.controller.js:L22` |
| S5 | Webhook secret so sánh plain text | `webhook.controller.js:L16` |
| P4 | Không có timeout cho Telegram API calls | `telegram.service.js` |

---

## 🧪 Test Coverage Hiện Tại

```
Tests:       26 passed, 26 total (0.4s)
├── tests/sanitize.test.js     (14 tests)
│   ├── sanitizeJqlString      (8 tests)
│   └── sanitizeSprintId       (6 tests)
└── tests/bottleneck.test.js   (12 tests)
    ├── _msToWorkingHours      (6 tests)
    ├── analyzeChangelog        (4 tests)
    └── analyzeIssues           (2 tests)
```

**Chưa có test cho:**
- `report_orchestrator.service.js` (logic tính overdue, metrics)
- `excel.service.js` (tạo Excel report)
- `command.controller.js` (xử lý lệnh)
- `cron.controller.js` (alert scan logic)

---

## 🔧 Thông Tin Triển Khai

| Config | Giá trị |
|--------|---------|
| **Hosting** | Render (Free tier) |
| **Database** | PostgreSQL (Render, SSL enabled) |
| **Telegram** | Polling mode (interval: 3s) |
| **Jira API** | REST API v2, Basic Auth |
| **Chart** | QuickChart.io (free tier: 250 charts/month) |
| **Node.js** | CommonJS modules |

### Biến Môi Trường Quan Trọng

| Variable | Mục đích |
|----------|---------|
| `CRON_SCHEDULE` | Lịch quét cảnh báo (mặc định: mỗi phút) |
| `REPORT_CRON_SCHEDULE` | Lịch báo cáo (hiện tạm tắt) |
| `SPRINT_UNDERLOAD_HOURS` | Ngưỡng cảnh báo trống việc (default: 10h) |
| `SPRINT_OVERLOAD_HOURS` | Ngưỡng cảnh báo quá tải (default: 40h) |
| `DATABASE_URL` | PostgreSQL connection string |
| `DATABASE_SSL` | Enable SSL cho DB connection |

---

## 📝 Lịch Sử Thay Đổi Gần Đây

| Ngày | Thay đổi |
|------|----------|
| 20/03/2026 | Fix JQL Injection, tối ưu bottleneck (expand=changelog), thêm Jest tests, fix cron JQL |
| 19/03/2026 | Fix overdue logic (3 tầng), redesign Excel Sheet 1, tắt `/report_now`, thêm cột Overdue Yes/No |
| 18/03/2026 | Migrate chart → QuickChart.io, fix effort calculation (include Done), thêm Overdue Tickets column |
| 17/03/2026 | Pagination cho Jira API, mute sprint integration, tắt cron report |
| 16/03/2026 | Fix `/scan_all` chỉ gửi về group gọi lệnh |
