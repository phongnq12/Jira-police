const { sanitizeJqlString, sanitizeSprintId } = require('../src/utils/sanitize');

describe('sanitizeJqlString', () => {
    test('removes double quotes', () => {
        expect(sanitizeJqlString('Nguyễn "Văn" Lưu')).toBe('Nguyễn Văn Lưu');
    });

    test('removes backslashes', () => {
        expect(sanitizeJqlString('test\\injection')).toBe('testinjection');
    });

    test('removes brackets and parens', () => {
        expect(sanitizeJqlString('test(OR)project[key]')).toBe('testORprojectkey');
    });

    test('removes semicolons and pipes', () => {
        expect(sanitizeJqlString('name;DROP|TABLE')).toBe('nameDROPTABLE');
    });

    test('trims whitespace', () => {
        expect(sanitizeJqlString('  Nguyễn Văn Lưu  ')).toBe('Nguyễn Văn Lưu');
    });

    test('returns empty string for null/undefined', () => {
        expect(sanitizeJqlString(null)).toBe('');
        expect(sanitizeJqlString(undefined)).toBe('');
        expect(sanitizeJqlString('')).toBe('');
    });

    test('handles non-string input', () => {
        expect(sanitizeJqlString(123)).toBe('');
    });

    test('preserves Vietnamese characters', () => {
        expect(sanitizeJqlString('Nguyễn Thị Hương')).toBe('Nguyễn Thị Hương');
    });
});

describe('sanitizeSprintId', () => {
    test('accepts valid positive integer', () => {
        expect(sanitizeSprintId('142')).toBe(142);
        expect(sanitizeSprintId('1')).toBe(1);
    });

    test('rejects negative numbers', () => {
        expect(sanitizeSprintId('-5')).toBeNull();
    });

    test('rejects zero', () => {
        expect(sanitizeSprintId('0')).toBeNull();
    });

    test('rejects non-numeric strings', () => {
        expect(sanitizeSprintId('abc')).toBeNull();
        expect(sanitizeSprintId('142; DROP TABLE')).toBeNull();
    });

    test('rejects null/undefined', () => {
        expect(sanitizeSprintId(null)).toBeNull();
        expect(sanitizeSprintId(undefined)).toBeNull();
    });

    test('trims whitespace before parsing', () => {
        expect(sanitizeSprintId(' 142 ')).toBe(142);
    });
});
