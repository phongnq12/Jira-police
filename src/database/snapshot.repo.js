const { Pool } = require('pg');
const config = require('../config/env');

/**
 * Repository layer cho bảng project_health_snapshots.
 * Sử dụng pg Pool để quản lý connection tới PostgreSQL.
 */
class SnapshotRepository {
    constructor() {
        this.pool = null;
    }

    /**
     * Khởi tạo Pool kết nối PostgreSQL (gọi 1 lần duy nhất khi app start)
     */
    init() {
        if (!config.DATABASE_URL) {
            console.warn('[SnapshotRepo] ⚠️ DATABASE_URL chưa được cấu hình. Module Reporting sẽ bị vô hiệu hóa.');
            return;
        }

        this.pool = new Pool({
            connectionString: config.DATABASE_URL,
            ssl: config.DATABASE_SSL ? { rejectUnauthorized: false } : false,
            max: 5,
            idleTimeoutMillis: 30000,
            connectionTimeoutMillis: 10000
        });

        this.pool.on('error', (err) => {
            console.error('[SnapshotRepo] ❌ Lỗi kết nối PostgreSQL:', err.message);
        });

        console.log('[SnapshotRepo] ✅ Đã khởi tạo kết nối PostgreSQL.');

        // Auto-migrate: Tự tạo bảng nếu chưa tồn tại
        this._autoMigrate();
    }

    /**
     * Tự động tạo bảng project_health_snapshots khi app khởi động.
     * Không cần chạy init.sql thủ công — phù hợp với Render Free tier (không có Shell).
     */
    async _autoMigrate() {
        const createTableSQL = `
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

                CONSTRAINT uq_snapshot_daily UNIQUE (snapshot_date, project_key, sprint_id)
            );

            CREATE INDEX IF NOT EXISTS idx_snapshot_date ON project_health_snapshots (snapshot_date);
            CREATE INDEX IF NOT EXISTS idx_snapshot_project ON project_health_snapshots (project_key, snapshot_date);

            CREATE TABLE IF NOT EXISTS bot_state (
                key     VARCHAR(100) PRIMARY KEY,
                value   TEXT NOT NULL,
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            );
        `;

        try {
            await this.pool.query(createTableSQL);
            console.log('[SnapshotRepo] ✅ Auto-migrate thành công: bảng project_health_snapshots + bot_state đã sẵn sàng.');
        } catch (error) {
            console.error('[SnapshotRepo] ❌ Lỗi auto-migrate:', error.message);
        }
    }

    /**
     * Kiểm tra xem pool đã sẵn sàng chưa
     */
    isReady() {
        return this.pool !== null;
    }

    /**
     * Insert hoặc Update (Upsert) snapshot hàng ngày.
     * Nếu đã có record cho ngày + project + sprint đó → cập nhật lại.
     */
    async upsertSnapshot(data) {
        if (!this.isReady()) return null;

        const query = `
            INSERT INTO project_health_snapshots 
                (snapshot_date, project_key, sprint_id, sprint_name,
                 total_tasks, done_tasks, overdue_tasks, blocked_tasks, 
                 missing_est, total_time_spent_seconds, total_original_est_seconds)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            ON CONFLICT (snapshot_date, project_key, sprint_id)
            DO UPDATE SET
                sprint_name = EXCLUDED.sprint_name,
                total_tasks = EXCLUDED.total_tasks,
                done_tasks = EXCLUDED.done_tasks,
                overdue_tasks = EXCLUDED.overdue_tasks,
                blocked_tasks = EXCLUDED.blocked_tasks,
                missing_est = EXCLUDED.missing_est,
                total_time_spent_seconds = EXCLUDED.total_time_spent_seconds,
                total_original_est_seconds = EXCLUDED.total_original_est_seconds
            RETURNING *;
        `;

        const values = [
            data.snapshotDate,
            data.projectKey,
            data.sprintId,
            data.sprintName,
            data.totalTasks,
            data.doneTasks,
            data.overdueTasks,
            data.blockedTasks,
            data.missingEst,
            data.totalTimeSpentSeconds,
            data.totalOriginalEstSeconds
        ];

        try {
            const result = await this.pool.query(query, values);
            console.log(`[SnapshotRepo] ✅ Upsert snapshot thành công cho ${data.projectKey} ngày ${data.snapshotDate}`);
            return result.rows[0];
        } catch (error) {
            console.error('[SnapshotRepo] ❌ Lỗi upsert snapshot:', error.message);
            throw error;
        }
    }

    /**
     * Lấy snapshots theo khoảng thời gian (dùng cho vẽ biểu đồ trend)
     * @param {string} projectKey Mã dự án Jira
     * @param {number} days Số ngày gần nhất cần lấy (mặc định 30)
     */
    async getSnapshots(projectKey, days = 30) {
        if (!this.isReady()) return [];

        const query = `
            SELECT * FROM project_health_snapshots
            WHERE project_key = $1
              AND snapshot_date >= CURRENT_DATE - INTERVAL '1 day' * $2
            ORDER BY snapshot_date ASC;
        `;

        try {
            const result = await this.pool.query(query, [projectKey, days]);
            return result.rows;
        } catch (error) {
            console.error('[SnapshotRepo] ❌ Lỗi query snapshots:', error.message);
            return [];
        }
    }

    /**
     * Lấy snapshot mới nhất cho 1 project (dùng cho Radar Chart)
     */
    async getLatestSnapshot(projectKey) {
        if (!this.isReady()) return null;

        const query = `
            SELECT * FROM project_health_snapshots
            WHERE project_key = $1
            ORDER BY snapshot_date DESC
            LIMIT 1;
        `;

        try {
            const result = await this.pool.query(query, [projectKey]);
            return result.rows[0] || null;
        } catch (error) {
            console.error('[SnapshotRepo] ❌ Lỗi query latest snapshot:', error.message);
            return null;
        }
    }

    /**
     * Lấy giá trị state từ bảng bot_state
     * @param {string} key Tên key cần lấy
     * @returns {string|null} Giá trị hoặc null nếu không tồn tại
     */
    async getState(key) {
        if (!this.isReady()) return null;
        try {
            const result = await this.pool.query(
                'SELECT value FROM bot_state WHERE key = $1', [key]
            );
            return result.rows.length > 0 ? result.rows[0].value : null;
        } catch (error) {
            console.error(`[SnapshotRepo] ❌ Lỗi getState(${key}):`, error.message);
            return null;
        }
    }

    /**
     * Lưu giá trị state vào bảng bot_state (upsert)
     * @param {string} key Tên key
     * @param {string} value Giá trị cần lưu
     */
    async setState(key, value) {
        if (!this.isReady()) return;
        try {
            await this.pool.query(
                `INSERT INTO bot_state (key, value, updated_at) VALUES ($1, $2, NOW())
                 ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
                [key, value]
            );
        } catch (error) {
            console.error(`[SnapshotRepo] ❌ Lỗi setState(${key}):`, error.message);
        }
    }
}

module.exports = new SnapshotRepository();
