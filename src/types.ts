
export interface Geofence {
    id: string;
    name: string;
    active: boolean;
    radiusMeters: number;
    center: { lat: number; lng: number };
    teamId: string;
    createdBy: string;
    createdAt: any;
}
