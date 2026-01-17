import { Module } from '@nestjs/common';
import { ProfileController } from './profile.controller';
import { GemloginService } from './gemlogin.service';
import { ProfileStateService } from './profile-state.service';
import { AutomationModule } from '../automation/automation.module';

@Module({
    imports: [AutomationModule],
    controllers: [ProfileController],
    providers: [GemloginService, ProfileStateService],
    exports: [GemloginService, ProfileStateService],
})
export class ProfileModule { }
