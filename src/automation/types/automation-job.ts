/**
 * Thông tin một job automation
 */
export interface AutomationJob {
    profileId: number;
    remoteDebugAddress: string;
    sheetRow?: any;
}

/**
 * Kết quả sau khi chạy automation
 */
export interface AutomationResult {
    profileId: number;
    success: boolean;
    error?: string;
    data?: any;
}
