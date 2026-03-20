const BottleneckService = require('../src/services/bottleneck.service');

describe('BottleneckService', () => {
    const service = BottleneckService;

    describe('_msToWorkingHours', () => {
        test('8 hours real = 8 working hours (same day)', () => {
            const ms = 8 * 60 * 60 * 1000; // 8h
            expect(service._msToWorkingHours(ms)).toBe(8);
        });

        test('24 hours = 1 day = 8 working hours', () => {
            const ms = 24 * 60 * 60 * 1000;
            expect(service._msToWorkingHours(ms)).toBe(8);
        });

        test('48 hours = 2 days = 16 working hours', () => {
            const ms = 48 * 60 * 60 * 1000;
            expect(service._msToWorkingHours(ms)).toBe(16);
        });

        test('36 hours = 1 day + 12h remainder (capped at 8) = 16h', () => {
            const ms = 36 * 60 * 60 * 1000;
            expect(service._msToWorkingHours(ms)).toBe(16);
        });

        test('30 hours = 1 day + 6h = 14 working hours', () => {
            const ms = 30 * 60 * 60 * 1000;
            expect(service._msToWorkingHours(ms)).toBe(14);
        });

        test('0 ms = 0 hours', () => {
            expect(service._msToWorkingHours(0)).toBe(0);
        });
    });

    describe('analyzeChangelog', () => {
        test('detects Done date from changelog', () => {
            const histories = [
                {
                    created: '2026-03-15T10:00:00.000+0700',
                    items: [{ field: 'status', toString: 'In Progress', fromString: 'To Do' }]
                },
                {
                    created: '2026-03-17T15:30:00.000+0700',
                    items: [{ field: 'status', toString: 'Done', fromString: 'In Progress' }]
                }
            ];

            const result = service.analyzeChangelog(histories);
            expect(result.doneDate).toBeInstanceOf(Date);
            expect(result.reopenCount).toBe(0);
        });

        test('counts re-opens correctly', () => {
            const histories = [
                {
                    created: '2026-03-15T10:00:00.000+0700',
                    items: [{ field: 'status', toString: 'In Progress', fromString: 'To Do' }]
                },
                {
                    created: '2026-03-16T10:00:00.000+0700',
                    items: [{ field: 'status', toString: 'Reopen', fromString: 'In Progress' }]
                },
                {
                    created: '2026-03-17T10:00:00.000+0700',
                    items: [{ field: 'status', toString: 'Reopened', fromString: 'Done' }]
                }
            ];

            const result = service.analyzeChangelog(histories);
            expect(result.reopenCount).toBe(2);
        });

        test('handles empty changelog', () => {
            const result = service.analyzeChangelog([]);
            expect(result.statusAging).toEqual({});
            expect(result.reopenCount).toBe(0);
            expect(result.doneDate).toBeNull();
        });

        test('ignores non-status changes', () => {
            const histories = [
                {
                    created: '2026-03-15T10:00:00.000+0700',
                    items: [{ field: 'assignee', toString: 'User A', fromString: 'User B' }]
                }
            ];

            const result = service.analyzeChangelog(histories);
            expect(result.reopenCount).toBe(0);
            expect(result.doneDate).toBeNull();
        });
    });

    describe('analyzeIssues', () => {
        test('skips cancelled tickets', async () => {
            const issues = [
                {
                    key: 'PROJ-1',
                    fields: {
                        status: { name: 'Cancelled' },
                        summary: 'Test',
                        assignee: { displayName: 'User A' }
                    },
                    changelog: { histories: [] }
                },
                {
                    key: 'PROJ-2',
                    fields: {
                        status: { name: 'In Progress' },
                        summary: 'Active Task',
                        assignee: { displayName: 'User B' },
                        duedate: '2026-03-17',
                        timeoriginalestimate: 28800,
                        timespent: 14400
                    },
                    changelog: { histories: [] }
                }
            ];

            const result = await service.analyzeIssues(issues);
            expect(result.issueAnalysis).toHaveLength(1);
            expect(result.issueAnalysis[0].key).toBe('PROJ-2');
        });

        test('maps fields correctly', async () => {
            const issues = [
                {
                    key: 'PROJ-5',
                    fields: {
                        status: { name: 'Done' },
                        summary: 'Completed Task',
                        assignee: { displayName: 'Nguyễn Văn Lưu' },
                        parent: { key: 'PROJ-1', fields: { summary: 'Parent Story' } },
                        duedate: '2026-03-17',
                        timeoriginalestimate: 28800,
                        timespent: 28800
                    },
                    changelog: { histories: [] }
                }
            ];

            const result = await service.analyzeIssues(issues);
            const item = result.issueAnalysis[0];
            expect(item.parentKey).toBe('PROJ-1');
            expect(item.assignee).toBe('Nguyễn Văn Lưu');
            expect(item.originalEstimate).toBe(28800);
            expect(item.timeSpent).toBe(28800);
        });
    });
});
