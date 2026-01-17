import { SheetRow } from '../../google-sheet/google-sheet.types';

export interface MappedJob {
    profileId: number;
    remoteDebugAddress: string;
    sheetRow: SheetRow;
}

export function mapSheetRowsToProfiles(
    rows: SheetRow[],
    profiles: { profile_id: number; remote_debugging_address: string }[],
): MappedJob[] {
    const count = Math.min(rows.length, profiles.length);

    const jobs: MappedJob[] = [];

    for (let i = 0; i < count; i++) {
        jobs.push({
            profileId: profiles[i].profile_id,
            remoteDebugAddress: profiles[i].remote_debugging_address,
            sheetRow: rows[i],
        });
    }

    return jobs;
}
