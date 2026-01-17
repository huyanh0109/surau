/**
 * Row trong sheet RentPhone
 * Columns: A=PhoneNumber, B=Api, C=DateTime, D=LastUse, E=Owner
 */
export interface PhoneRow {
    rowIndex: number;
    PhoneNumber: string;
    Api: string;
    DateTime: string;
    LastUse: string;
    Owner: string;
}
