import { Module, Global } from '@nestjs/common';
import { LogStreamService } from './log-stream.service';
import { LogStreamController } from './log-stream.controller';

@Global()
@Module({
    providers: [LogStreamService],
    controllers: [LogStreamController],
    exports: [LogStreamService],
})
export class LogStreamModule { }
