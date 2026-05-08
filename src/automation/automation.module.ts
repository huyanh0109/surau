import { Module } from '@nestjs/common';
import { AutomationController } from './automation.controller';
import { AutomationService } from './automation.service';
import { AutomationRunner } from './engines/automation-runner';
import { XsurauRunner } from './engines/xsurau-runner';
import { ChromeService } from './browser/chrome.service';
import { XsurauService } from './browser/xsurau.service';

@Module({
    controllers: [AutomationController],
    providers: [AutomationService, AutomationRunner, XsurauRunner, ChromeService, XsurauService],
    exports: [AutomationService, ChromeService, XsurauService, XsurauRunner],
})
export class AutomationModule { }
