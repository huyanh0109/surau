import { Injectable } from '@nestjs/common';

export interface OpenedProfileInfo {
    profile_id: string;
    remote_debugging_address: string;
    win_pos?: string;
    win_size?: string;
}

@Injectable()
export class ProfileStateService {
    // Lưu trạng thái profiles đang mở
    private openedProfiles: Map<string, OpenedProfileInfo> = new Map();

    // Lưu URL cuối cùng của mỗi profile
    private profileUrls: Map<string, string> = new Map();

    // Lưu sheet data trong RAM
    private cachedSheetRows: any[] = [];

    /**
     * Đánh dấu profile đã mở
     */
    setProfileOpened(profileId: string, info: OpenedProfileInfo) {
        this.openedProfiles.set(profileId, info);
    }

    /**
     * Đánh dấu profile đã đóng
     */
    setProfileClosed(profileId: string) {
        this.openedProfiles.delete(profileId);
    }

    /**
     * Lấy danh sách profiles đang mở
     */
    getOpenedProfiles(): OpenedProfileInfo[] {
        return Array.from(this.openedProfiles.values());
    }

    /**
     * Lưu URL hiện tại của profile
     */
    setProfileUrl(profileId: string, url: string) {
        this.profileUrls.set(profileId, url);
    }

    /**
     * Lấy URL đã lưu của profile
     */
    getProfileUrl(profileId: string): string | undefined {
        return this.profileUrls.get(profileId);
    }

    /**
     * Xóa tất cả trạng thái
     */
    clearAll() {
        this.openedProfiles.clear();
        this.profileUrls.clear();
    }

    /**
     * Lấy tổng số profiles đang mở
     */
    getOpenedCount(): number {
        return this.openedProfiles.size;
    }

    /**
     * Lưu sheet rows vào cache
     */
    setSheetRows(rows: any[]) {
        this.cachedSheetRows = rows;
    }

    /**
     * Lấy sheet rows từ cache
     */
    getSheetRows(): any[] {
        return this.cachedSheetRows;
    }

    /**
     * Lấy số lượng sheet rows
     */
    getSheetRowsCount(): number {
        return this.cachedSheetRows.length;
    }
}
