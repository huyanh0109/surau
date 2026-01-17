import { Module } from '@nestjs/common';
import { PhoneController } from './phone.controller';
import { PhoneService } from './phone.service';
import { PhoneQueueService } from './phone-queue.service';

@Module({
    controllers: [PhoneController],
    providers: [PhoneService, PhoneQueueService],
    exports: [PhoneService, PhoneQueueService],
})
export class PhoneModule { }
