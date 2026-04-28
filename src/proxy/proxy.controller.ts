import { Controller, Get, Post, Body } from '@nestjs/common';
import { ProxyService } from './proxy.service';

@Controller('proxy')
export class ProxyController {
    constructor(private readonly proxyService: ProxyService) { }

    @Get('config')
    getConfig() {
        return this.proxyService.getConfig();
    }

    @Post('config')
    updateConfig(@Body() dto: { proxy1?: string, proxy2?: string, captchaProxy?: string, activeIndex?: 1 | 2 }) {
        return this.proxyService.updateConfig(dto);
    }

    @Post('switch')
    switchProxy(@Body() dto: { index: 1 | 2 }) {
        return this.proxyService.switchProxy(dto.index);
    }

    @Post('rotate')
    rotateProxy() {
        return this.proxyService.rotateProxy();
    }
}
