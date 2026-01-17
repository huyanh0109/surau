import { Body, Controller, Get, Post } from '@nestjs/common';
import { AutomationService } from './automation.service';
import { AutomationJob } from './types/automation-job';

@Controller('automation')
export class AutomationController {
    constructor(private readonly automationService: AutomationService) { }

    @Post('run')
    async run(@Body() body: { automation: string; profiles: AutomationJob[] }) {
        const { automation, profiles } = body;
        return this.automationService.runAutomation(automation, profiles);
    }

    @Post('stop')
    stop() {
        return this.automationService.stopAutomation();
    }

    @Get('status')
    status() {
        return this.automationService.getStatus();
    }

    @Get('list')
    list() {
        return {
            automations: this.automationService.getAvailableAutomations(),
        };
    }

    @Post('capmonster/token')
    async switchToToken(@Body() body: { profiles: { profileId: string; remoteDebugAddress: string }[] }) {
        return this.automationService.switchCapMonsterMode(body.profiles, 'token');
    }

    @Post('capmonster/click')
    async switchToClick(@Body() body: { profiles: { profileId: string; remoteDebugAddress: string }[] }) {
        return this.automationService.switchCapMonsterMode(body.profiles, 'click');
    }

    @Post('capmonster/enable')
    async enableCapMonster(@Body() body: { profiles: { profileId: string; remoteDebugAddress: string }[] }) {
        return this.automationService.toggleCapMonster(body.profiles, 'enable');
    }

    @Post('capmonster/disable')
    async disableCapMonster(@Body() body: { profiles: { profileId: string; remoteDebugAddress: string }[] }) {
        return this.automationService.toggleCapMonster(body.profiles, 'disable');
    }
}
