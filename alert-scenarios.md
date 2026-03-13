# Tài liệu Nghiệp vụ Cảnh báo (Alert Scenarios) - Jira Master Bot

Tài liệu này tổng hợp toàn bộ các kịch bản cảnh báo đang được triển khai trên hệ thống Bot. Hệ thống hoạt động dựa trên 2 cơ chế độc lập: **Real-time (Thời gian thực qua Webhook)** và **Scheduled (Lịch trình chủ động qua Cronjob)**.

---

## PHẦN A. CẢNH BÁO THỜI GIAN THỰC (REAL-TIME WEBHOOK)
*Bot hoạt động ngay lập tức khi người dùng có thao tác Click/Lưu trên môi trường Jira.*

### 1. Kịch bản: Báo động Đỏ - Bottleneck (Blocked Alert)
*   **Mục đích:** Kêu gọi Scrum Master và Team ngay lập tức giải quyết vật cản lớn, tránh làm nghẽn cổ chai dự án.
*   **Trigger (Sự kiện):** Người dùng thay đổi trạng thái (Status) của Task.
*   **Điều kiện kích hoạt:** 
    * Thuộc tính `status` bị thay đổi.
    * Và trạng thái Đích đến (`toString`) có chứa từ khóa **"blocked"** (không phân biệt hoa/thường).
*   **Mức độ (Level):** 🛑 `ERROR` (Cảnh báo khẩn cấp).

### 2. Kịch bản: Dời Ngày Bí Mật (Silent Due Date Change)
*   **Mục đích:** Yêu cầu tính minh bạch trong Agile. Bất kì ai lùi lịch giao hàng đều phải đưa ra lý do giải trình.
*   **Trigger (Sự kiện):** Người dùng thay đổi Ngày đến hạn (Due Date) của Task.
*   **Điều kiện kích hoạt:** 
    * Thuộc tính `duedate` bị thay đổi (từ ngày cũ sang ngày mới).
    * **VÀ** người thao tác **KHÔNG** đính kèm bất kỳ Comment (Bình luận) nào trong cùng một cú Submit đó.
*   **Mức độ (Level):** ⚠️ `WARNING` (Nhắc nhở tính kỷ luật).

---

## PHẦN B. CẢNH BÁO THEO LỊCH TRÌNH (SCHEDULED CRONJOB)
*Bot tự động đóng vai PM đi tuần tra dự án mỗi ngày (hiện tại lúc test đang đặt 1 phút/lần). Dữ liệu đầu vào bộ lọc JQL: `Chỉ lấy các Task chưa hoàn thành (Unresolved) VÀ nằm trong Active Sprint hiện tại`.*

### 3. Kịch bản: Báo động Quá hạn (Overdue Task)
*   **Mục đích:** Tổng kết "nợ nần" của Sprint, không để các task làm Zombie trôi dạt.
*   **Điều kiện kích hoạt:** 
    * Task có cấu hình `duedate`.
    * Ngày `duedate` **nhỏ hơn** ngày `Today` (Thời điểm Bot quét hệ thống lúc nửa đêm/sáng).
*   **Mức độ (Level):** 🔥 `ERROR` (Khẩn điểm danh trừ KPI).

### 4. Kịch bản: Hạn chót Hôm nay (Deadline Today)
*   **Mục đích:** Thúc ép nhân sự rà soát lại khối lượng công việc để chắc chắn bàn giao được vào cuối ngày.
*   **Điều kiện kích hoạt:** 
    * Task có cấu hình `duedate`.
    * Ngày `duedate` **đúng bằng** Cột mốc ngày `Today` (Chênh lệch 0 ngày).
*   **Mức độ (Level):** 🚨 `WARNING` (Nhắc nhẹ chạy nước rút).

### 5. Kịch bản: Tràn Estimation / Log lố giờ (Scope Creep)
*   **Mục đích:** Báo hiệu sớm cho PM rằng Task này đang tốn nhiều "tiền" và công sức hơn mức được phê duyệt ban đầu. Cần đánh giá lại Requirement rủi ro phình to.
*   **Điều kiện kích hoạt:** 
    * Có dữ liệu ở trường Dự kiến (`timeoriginalestimate`) và Đã tiêu hao (`timespent`).
    * Số giờ Đã làm (`timespent`) **lớn hơn** Số giờ Dự kiến gốc (`timeoriginalestimate`).
*   **Mức độ (Level):** ⚠️ `WARNING` (Báo động cho PM quản lý Effort).

### 6. Kịch bản: Thiếu Thông Tin Planning (Missing Info Alert)
*   **Mục đích:** Không cho phép Team (Dev/BA) vứt thẻ Task bừa bãi vào Sprint mà không định lượng rõ ràng Khối lượng công việc và Ngày bàn giao.
*   **Điều kiện kích hoạt:** 
    * Task bị bỏ trống hoặc không có giá trị ở trường `duedate` (Ngày hết hạn) hoặc `timeoriginalestimate` (Estimate tổng lúc grooming).
    * **VÀ** task **KHÔNG** nằm ở các trạng thái đã đóng/hủy (`Cancelled`, `Done`, `Closed`, `Resolved`). Riêng đối với các trạng thái khởi tạo (`To do`, `Open`), Bot **CHỈ** bỏ qua nếu ticket đó thuộc thể loại `Bug` hoặc `Sub-bug` (để tránh spam khi QA vừa mới log lỗi). Đối với các task/story thông thường, nếu để "To do" mà trống thông tin vẫn sẽ bị báo động!
*   **Mức độ (Level):** ℹ️ `INFO` (Nhắc nhở bổ sung).
*   *Lưu ý: Kịch bản số 6 hiện đang được comment ẩn trong code của Bot để tránh bị Spam màn hình do dự án hiện tại đang có quá nhiều task để trống 2 tham số này.*

### 7. Kịch bản: Tàng Hình Log Work (Missing Worklog Alert)
*   **Mục đích:** Quản trị sát sao kỷ luật cập nhật thời gian làm việc để thu lượm dữ liệu báo cáo chính xác.
*   **Cơ chế kích hoạt:** Kết hợp cả 2 luồng (Real-time và Cronjob).
    *   **Luồng Webhook (Kích hoạt ngay):** Task bị User kéo Status thành `Done`, `Resolved` hoặc `Closed` nhưng trường `timespent` (đã log giờ) vẫn = 0.
    *   **Luồng Cronjob (Quét cuối ngày):** Task đang nằm ở Status `In Progress` hoặc `Doing` nhưng `timespent` bằng 0. (Lưu ý: Luồng này tạm khóa/ẩn trong source code hiện tại để tránh Spam dev mới nhận task).
*   **Mức độ (Level):** ⚠️ `WARNING` (Nhắc nhở cập nhật).

### 8. Kịch bản: Bầu Trời Trong Xanh (All Clear / Positive Reinforcement)
*   **Mục đích:** Khích lệ tinh thần làm việc của anh em, tạo không khí vui vẻ, bù trừ lại những lúc chỉ toàn nhận cảnh báo đỏ.
*   **Điều kiện kích hoạt:** 
    *   Kết quả sau khi Bot quét **toàn bộ** các kịch bản lỗi trong Phần B (Overdue, Deadline Today, Scope Creep, Missing Info, Missing Worklog) trả về **0 vi phạm**.
    *   Sẽ hoạt động như một điều kiện vớt (Else) trong luồng Cronjob (tuân theo lệnh chạy và tần suất cấu hình hiện tại của tác vụ tuần tra Phần B).
*   **Mức độ (Level):** 🌟 `SUCCESS` / `INFO` (Tuyên dương, ăn mừng).
*   **Hành động (Action):** Bot sẽ chọn ngẫu nhiên (random) một câu khen ngợi hài hước, mang tính chất động viên để gửi lên Group. (VD: *"Hôm nay team ngoan quá, xứng đáng 10 điểm không có nhưng! 🚀"*, *"Không một tiếng còi báo động nào, Em xin phép đi ngủ giữ sắc đẹp! 💅"*, *"Cả làng bình yên, các dev nhà mình nỗ lực tuyệt vời quá, mlem mlem! 🍗"*).

---

## PHẦN C. TƯƠNG TÁC 2 CHIỀU TỪ ADMIN (TELEGRAM COMMAND)
*Hệ thống chuyển sang chế độ Polling, cho phép Bot "lắng nghe" và thực thi các lệnh trực tiếp từ khung chat Telegram của Admin/PM.*

### 9. Lệnh: Kiểm tra tài nguyên Sprint & Tắt báo động
*   **1. Quét năng suất (`/check_effort`):**
    *   **Mục đích:** Tính toán và gom nhóm (Group by) số lượng công việc của từng thành viên trong Active Sprint, báo động nếu phát hiện Member bị trống việc hoặc quá tải.
    *   **Cú pháp Telegram:** Gõ lệnh `/check_effort` hoặc `/check_effort [sprint_id]` vào Group.
    *   **Kết quả:** Bot gọi API về Jira, tính tổng `timeoriginalestimate` của từng assignee và xuất ra báo cáo tóm tắt trên Telegram.
*   **2. Miễn trừ báo động (`/mute_sprint` & `/unmute_sprint`):**
    *   **Mục đích:** Cho phép Admin chỉ định tắt/bỏ qua chức năng Cảnh báo tự động đối với một cột mốc kết thúc Sprint nhất định.
    *   **Cú pháp Telegram:** Gõ lệnh `/mute_sprint [sprint_id]`.
    *   **Kết quả:** Bot sẽ lưu ID này vào bộ nhớ Local JSON (Database) và tắt tiếng đối với toàn bộ các kịch bản báo cáo của Sprint này.

### 10. Lệnh: Kiểm tra danh sách công việc còn lại và estimated time của công việc đó trong Sprint
*   **Mục đích:** Kiểm tra danh sách công việc còn lại và estimated time của công việc đó trong Sprint đối với từng nhân sự `assignee`.
*   **Cú pháp Telegram:** Gõ lệnh `/check_remaining_tasks` hoặc `/check_remaining_tasks [sprint_id]` vào Group.
*   **Kết quả:** Bot gọi API về Jira, đếm từng task  có trạng thái khác `Done` và tổng hợp `remainingestimate` của từng assignee và xuất ra báo cáo tóm tắt trên Telegram.

### 11. Lệnh: Quét toàn diện dự án (Bỏ qua giới hạn Active Sprint)
*   **Mục đích:** Khi PM/Admin cần một góc nhìn tổng quan về hệ thống, vượt ra ngoài phạm vi tác vụ đang chạy trong Sprint hiện tại (Bao gồm cả Backlog, Sprint khác, hoặc Task vô gia cư...).
*   **Cú pháp Telegram:** Gõ lệnh `/scan_all` vào Group.
*   **Kết quả:** Bot lập tức chạy lại bộ quét 5 kịch bản cảnh báo của Phần B (Deadline, Log work...) ĐỐI VỚI TOÀN BỘ DỰ ÁN (`resolution = Unresolved`), sau đó bắn toàn bộ kết quả vi phạm bắt được lên group chat. Đây là lệnh Report hạng nặng, mang tính rà soát định kỳ.

---
**Tất cả các cảnh báo trên đều thông qua "Màng lọc Sandbox (User Mapping)" để mã hoá định danh Tag, đảm bảo gửi chéo an toàn cho Group Telegram / Teams nội bộ mà không làm phiền người dùng cuối.**
