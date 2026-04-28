import { Controller, Sse } from '@nestjs/common';
import { LogStreamService } from './log-stream.service';
import { Observable } from 'rxjs';

@Controller('log-stream')
export class LogStreamController {
    constructor(private readonly logStreamService: LogStreamService) { }

    @Sse('stream')
    stream(): Observable<any> {
        return this.logStreamService.getStream();
    }
}
