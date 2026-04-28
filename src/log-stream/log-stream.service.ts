import { Injectable } from '@nestjs/common';
import { Subject, Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export interface LogMessage {
    message: string;
    type?: 'info' | 'success' | 'warning' | 'error';
    timestamp: string;
}

@Injectable()
export class LogStreamService {
    private logs$ = new Subject<LogMessage>();

    log(message: string, type: 'info' | 'success' | 'warning' | 'error' = 'info') {
        this.logs$.next({
            message,
            type,
            timestamp: new Date().toLocaleTimeString(),
        });
    }

    getStream(): Observable<{ data: LogMessage }> {
        return this.logs$.asObservable().pipe(
            map((log) => ({ data: log })),
        );
    }
}
