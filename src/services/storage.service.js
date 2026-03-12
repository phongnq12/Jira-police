const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, '../data/mute-settings.json');

/**
 * Service để đọc ghi dữ liệu cục bộ vào file JSON
 * Phục vụ lưu trữ state "Mute Alert" của Sprint.
 */
class StorageService {
    constructor() {
        this._ensureFileExists();
    }

    _ensureFileExists() {
        if (!fs.existsSync(DATA_FILE)) {
            fs.writeFileSync(DATA_FILE, JSON.stringify({ mutedSprints: [] }, null, 2), 'utf8');
        }
    }

    _readData() {
        try {
            const rawData = fs.readFileSync(DATA_FILE, 'utf8');
            return JSON.parse(rawData);
        } catch (e) {
            console.error('[StorageService] Lỗi đọc file data:', e.message);
            return { mutedSprints: [] };
        }
    }

    _writeData(data) {
        try {
            fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
            return true;
        } catch (e) {
            console.error('[StorageService] Lỗi ghi file data:', e.message);
            return false;
        }
    }

    /**
     * Kiểm tra xem Sprint ID này đã bị Mute chưa
     */
    isSprintMuted(sprintId) {
        const data = this._readData();
        return data.mutedSprints.includes(String(sprintId));
    }

    /**
     * Tắt báo động (Mute) cho 1 Sprint
     */
    muteSprint(sprintId) {
        const data = this._readData();
        const strId = String(sprintId);
        if (!data.mutedSprints.includes(strId)) {
            data.mutedSprints.push(strId);
            this._writeData(data);
        }
        return true;
    }

    /**
     * Mở lại báo động (Unmute) cho 1 Sprint
     */
    unmuteSprint(sprintId) {
        const data = this._readData();
        const strId = String(sprintId);
        data.mutedSprints = data.mutedSprints.filter(id => id !== strId);
        this._writeData(data);
        return true;
    }
}

module.exports = new StorageService();
