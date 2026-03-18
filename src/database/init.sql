-- ================================================================
-- Bảng: project_health_snapshots
-- Lưu trữ "bức ảnh" sức khỏe dự án mỗi ngày lúc 23:59
-- Dùng để vẽ biểu đồ đường (Trend) theo tuần/tháng
-- ================================================================

CREATE TABLE IF NOT EXISTS project_health_snapshots (
    id              SERIAL PRIMARY KEY,
    snapshot_date   DATE NOT NULL,
    project_key     VARCHAR(50) NOT NULL,
    sprint_id       VARCHAR(50),
    sprint_name     VARCHAR(200),

    total_tasks     INTEGER NOT NULL DEFAULT 0,
    done_tasks      INTEGER NOT NULL DEFAULT 0,
    overdue_tasks   INTEGER NOT NULL DEFAULT 0,
    blocked_tasks   INTEGER NOT NULL DEFAULT 0,
    missing_est     INTEGER NOT NULL DEFAULT 0,
    total_time_spent_seconds BIGINT NOT NULL DEFAULT 0,
    total_original_est_seconds BIGINT NOT NULL DEFAULT 0,

    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    -- Đảm bảo mỗi ngày chỉ có 1 record cho mỗi cặp project + sprint
    CONSTRAINT uq_snapshot_daily UNIQUE (snapshot_date, project_key, sprint_id)
);

-- Index tăng tốc truy vấn theo ngày và project
CREATE INDEX IF NOT EXISTS idx_snapshot_date ON project_health_snapshots (snapshot_date);
CREATE INDEX IF NOT EXISTS idx_snapshot_project ON project_health_snapshots (project_key, snapshot_date);
