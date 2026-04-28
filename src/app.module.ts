import { Module } from '@nestjs/common';
import { ProfileModule } from './profile/profile.module';
import { AutomationModule } from './automation/automation.module';
import { GoogleSheetModule } from './google-sheet/google-sheet.module';
import { PhoneModule } from './phone/phone.module';
import { ConfigModule } from '@nestjs/config';

import { ProxyModule } from './proxy/proxy.module';
import { LogStreamModule } from './log-stream/log-stream.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    ProxyModule,
    LogStreamModule,
    ProfileModule,
    AutomationModule,
    GoogleSheetModule,
    PhoneModule,
  ],
})
export class AppModule { }

