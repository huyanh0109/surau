import { Module, forwardRef } from '@nestjs/common';
import { ProxyService } from './proxy.service';
import { ProxyController } from './proxy.controller';
import { ProfileModule } from '../profile/profile.module';
import { AutomationModule } from '../automation/automation.module';

@Module({
    imports: [forwardRef(() => ProfileModule), forwardRef(() => AutomationModule)],
    providers: [ProxyService],
    controllers: [ProxyController],
    exports: [ProxyService],
})
export class ProxyModule { }
