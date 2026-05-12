/**
 * Sync Sheet helper — Lấy data từ Google Sheet qua Surau API (localhost:API_PORT)
 * để map vào profileIds khi chạy automation trong Xsurau.
 *
 * Cách dùng qua API:
 * GET /api/sheet/sync?sheetName=FactoryAccount&status=disable
 *
 * Trả về: { rows: [ { Gmail, PassWord, Recover, Phone, Note, ... } ] }
 */

const express = require('express');

function registerSheetRoutes(app, automationEngine) {
    /**
     * Lấy toàn bộ rows từ sheet (qua Surau)
     * GET /api/sheet/rows?status=disable&limit=50
     */
    app.get('/api/sheet/rows', async (req, res) => {
        try {
            const { status, limit = 100, sheetType = 'main' } = req.query;

            // Gọi Surau Sheet API
            let url = `http://localhost:${process.env.API_PORT || 3333}/sheet/rows?limit=${limit}`;
            if (status) url += `&status=${encodeURIComponent(status)}`;
            if (sheetType) url += `&sheetType=${sheetType}`;

            const response = await fetch(url);
            if (!response.ok) {
                return res.status(response.status).json({ error: `Surau sheet API error: ${response.status}` });
            }
            const data = await response.json();
            res.json(data);
        } catch (e) {
            res.status(500).json({ error: `Lỗi kết nối Surau: ${e.message}` });
        }
    });

    /**
     * Lấy rows và map tự động vào danh sách profileIds theo thứ tự
     * POST /api/sheet/sync-to-profiles
     * Body: { profileIds: string[], status?: string, limit?: number }
     *
     * Trả về: { jobs: [ { profileId, sheetRow } ] }
     */
    app.post('/api/sheet/sync-to-profiles', async (req, res) => {
        try {
            const { profileIds, status, limit } = req.body;
            if (!profileIds?.length) return res.status(400).json({ error: 'Thiếu profileIds' });

            // Lấy rows từ sheet
            let url = `http://localhost:${process.env.API_PORT || 3333}/sheet/rows?limit=${limit || profileIds.length}`;
            if (status) url += `&status=${encodeURIComponent(status)}`;

            const response = await fetch(url);
            if (!response.ok) return res.status(500).json({ error: 'Không lấy được data từ Sheet' });

            const { rows = [] } = await response.json();

            // Map profileId <-> sheetRow theo thứ tự
            const jobs = profileIds.map((profileId, i) => ({
                profileId,
                sheetRow: rows[i] || null,
            })).filter(j => j.sheetRow); // bỏ profile không có data

            res.json({ success: true, total: jobs.length, jobs });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });
}

module.exports = { registerSheetRoutes };
