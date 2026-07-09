export type Role = 'CLIENTE' | 'PERSONAL' | 'ADMIN';

export type AuthResponse = {
  token: string;
  userId: number;
  fullName: string;
  email: string;
  role: Role;
};

export type Court = {
  id: number;
  name: string;
  description?: string;
  hourlyPrice: number;
  active: boolean;
};

export type Reservation = {
  id: number;
  clientId: number;
  clientName: string;
  courtId: number;
  courtName: string;
  reservationDate: string;
  startTime: string;
  endTime: string;
  status: 'PENDIENTE' | 'CONFIRMADA' | 'CANCELADA' | 'FINALIZADA';
  totalAmount: number;
  paymentStatus: 'PENDIENTE' | 'ADELANTO' | 'PAGADO';
  notes?: string;
};
