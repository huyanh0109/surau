/**
 * Thông tin một job automation
 */
export interface AutomationJob {
    profileId: string | number;
    remoteDebugAddress?: string;
    sheetRow?: any;
    blockImages?: boolean;
    startUrl?: string;
}

/**
 * Kết quả sau khi chạy automation
 */
export interface AutomationResult {
    profileId: string | number;
    success: boolean;
    error?: string;
    data?: any;
}
