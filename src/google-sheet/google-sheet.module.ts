import { Module } from '@nestjs/common';
import { GoogleSheetService } from './google-sheet.service';
import { GoogleSheetController } from './google-sheet.controller';
import { ProfileModule } from '../profile/profile.module';

@Module({
    imports: [ProfileModule],
    controllers: [GoogleSheetController],
    providers: [GoogleSheetService],
    exports: [GoogleSheetService],
})
export class GoogleSheetModule { }
