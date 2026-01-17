import { Injectable } from '@nestjs/common';
import { PhoneService } from './phone.service';

interface PhoneAssignment {
    phoneNumber: string;
    assignedToProfile: number | null;
    checkedByProfiles: Set<number>;
    isValid: boolean | null; // null = chưa check, true/false = kết quả
}

@Injectable()
export class PhoneQueueService {
    private phones: PhoneAssignment[] = [];
    private loadedAt: Date | null = null;

    constructor(private readonly phoneService: PhoneService) { }

    /**
     * Load 70 phones chưa dùng từ Google Sheet vào RAM
     */
    async loadPhones(): Promise<{ success: boolean; total: number; message: string }> {
        try {
            // Lấy 70 số có LastUse > 5 ngày
            const availablePhones = await this.phoneService.getAvailablePhones(5, 70);

            if (availablePhones.length === 0) {
                return {
                    success: false,
                    total: 0,
                    message: 'No available phones found (all phones used within last 5 days)',
                };
            }

            // Convert to PhoneAssignment và filter out empty phones
            this.phones = availablePhones
                .filter((phone) => phone.PhoneNumber && phone.PhoneNumber.trim() !== '')
                .map((phone) => ({
                    phoneNumber: phone.PhoneNumber.trim(),
                    assignedToProfile: null,
                    checkedByProfiles: new Set<number>(),
                    isValid: null,
                }));

            this.loadedAt = new Date();

            // console.log(`📋 Loaded ${this.phones.length} phones to queue at ${this.loadedAt.toISOString()}`);

            return {
                success: true,
                total: this.phones.length,
                message: `Loaded ${this.phones.length} phones to queue`,
            };
        } catch (error: any) {
            console.error('Failed to load phones:', error.message);
            return {
                success: false,
                total: 0,
                message: `Failed to load phones: ${error.message}`,
            };
        }
    }

    /**
     * Lấy số tiếp theo cho profile
     * - Ưu tiên số chưa ai assign
     * - Nếu không có, lấy số invalid mà profile này chưa check
     */
    getNextPhone(profileId: number): { phoneNumber: string } | null {
        // Tìm số chưa assign hoặc đã release (assignedToProfile = null)
        // mà profile này chưa check
        const available = this.phones.find(
            (p) => p.assignedToProfile === null && !p.checkedByProfiles.has(profileId)
        );

        if (available && available.phoneNumber && available.phoneNumber.trim() !== '') {
            available.assignedToProfile = profileId;
            // console.log(`📞 Assigned ${available.phoneNumber} to profile ${profileId}`);
            return { phoneNumber: available.phoneNumber };
        }

        // Nếu không có số nào available, return null
        const totalAvailable = this.phones.filter(p => p.assignedToProfile === null && !p.checkedByProfiles.has(profileId)).length;
        console.log(`⚠️ No more phones available for profile ${profileId}. Total available for others: ${totalAvailable}`);
        return null;
    }

    /**
     * Mark kết quả check
     */
    markPhoneResult(phoneNumber: string, profileId: number, isValid: boolean): { success: boolean; message: string } {
        const phone = this.phones.find((p) => p.phoneNumber === phoneNumber);

        if (!phone) {
            return {
                success: false,
                message: `Phone ${phoneNumber} not found in queue`,
            };
        }

        // Add profile vào checkedByProfiles
        phone.checkedByProfiles.add(profileId);

        // Set kết quả
        phone.isValid = isValid;

        // Unassign (để profile khác có thể check nếu invalid)
        phone.assignedToProfile = null;

        const status = isValid ? '✅ VALID' : '❌ INVALID';
        console.log(`${status} - ${phoneNumber} checked by profile ${profileId}`);

        return {
            success: true,
            message: `Marked ${phoneNumber} as ${isValid ? 'valid' : 'invalid'} by profile ${profileId}`,
        };
    }

    /**
     * Reset queue và load 70 số mới
     */
    async resetQueue(): Promise<{ success: boolean; total: number; message: string }> {
        // console.log('🔄 Resetting queue...');
        this.phones = [];
        this.loadedAt = null;

        return this.loadPhones();
    }

    /**
     * Lấy thống kê queue
     */
    getStatus() {
        const total = this.phones.length;
        const assigned = this.phones.filter((p) => p.assignedToProfile !== null).length;
        const checked = this.phones.filter((p) => p.isValid !== null).length;
        const valid = this.phones.filter((p) => p.isValid === true).length;
        const invalid = this.phones.filter((p) => p.isValid === false).length;
        const available = this.phones.filter((p) => p.assignedToProfile === null && p.isValid === null).length;

        return {
            total,
            assigned,
            checked,
            valid,
            invalid,
            available,
            loadedAt: this.loadedAt?.toISOString() || null,
            phones: this.phones.map((p) => ({
                phoneNumber: p.phoneNumber,
                assignedToProfile: p.assignedToProfile,
                checkedByCount: p.checkedByProfiles.size,
                isValid: p.isValid,
            })),
        };
    }
}
