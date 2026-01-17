import { Controller, Get, Post, Body, Query } from '@nestjs/common';
import { PhoneService } from './phone.service';
import { PhoneQueueService } from './phone-queue.service';

@Controller('phone')
export class PhoneController {
    constructor(
        private readonly phoneService: PhoneService,
        private readonly queueService: PhoneQueueService,
    ) { }

    /**
     * GET /phone/lookup?number=0123456789
     * Tìm số điện thoại và gọi API
     */
    @Get('lookup')
    async lookup(@Query('number') phoneNumber: string) {
        if (!phoneNumber) {
            return { error: 'Missing phone number. Use ?number=xxx' };
        }
        return this.phoneService.lookupAndCallApi(phoneNumber);
    }

    /**
     * GET /phone/all
     * Lấy tất cả số điện thoại
     */
    @Get('all')
    async getAll() {
        const phones = await this.phoneService.getAllPhones();
        return { total: phones.length, phones };
    }

    /**
     * GET /phone/available?days=5&limit=50
     * Lấy số điện thoại có thể dùng (LastUse > X ngày)
     */
    @Get('available')
    async getAvailable(
        @Query('days') days?: string,
        @Query('limit') limit?: string,
    ) {
        const daysSinceLastUse = days ? parseInt(days) : 5;
        const maxLimit = limit ? parseInt(limit) : 50;

        const phones = await this.phoneService.getAvailablePhones(daysSinceLastUse, maxLimit);
        return { total: phones.length, phones };
    }

    // === QUEUE MANAGEMENT ===

    /**
     * POST /phone/queue/load
     * Load 50 phones vào RAM
     */
    @Post('queue/load')
    async loadQueue() {
        return this.queueService.loadPhones();
    }

    /**
     * GET /phone/queue/next?profileId=123
     * Lấy số tiếp theo cho profile
     */
    @Get('queue/next')
    async getNextPhone(@Query('profileId') profileIdStr: string) {
        if (!profileIdStr) {
            return { error: 'Missing profileId parameter' };
        }

        const profileId = parseInt(profileIdStr);
        const phone = this.queueService.getNextPhone(profileId);

        if (!phone) {
            return { error: 'No more phones available for this profile' };
        }

        return phone;
    }

    /**
     * POST /phone/queue/mark
     * Mark kết quả check
     */
    @Post('queue/mark')
    async markPhone(@Body() body: { phoneNumber: string; profileId: number; isValid: boolean }) {
        const { phoneNumber, profileId, isValid } = body;

        if (!phoneNumber || profileId === undefined || isValid === undefined) {
            return {
                success: false,
                message: 'Missing required fields: phoneNumber, profileId, isValid',
            };
        }

        return this.queueService.markPhoneResult(phoneNumber, profileId, isValid);
    }

    /**
     * POST /phone/queue/reset
     * Reset queue và load 50 số mới
     */
    @Post('queue/reset')
    async resetQueue() {
        return this.queueService.resetQueue();
    }

    /**
     * GET /phone/queue/status
     * Lấy thống kê queue
     */
    @Get('queue/status')
    async getQueueStatus() {
        return this.queueService.getStatus();
    }
}
