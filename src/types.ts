export type Role = 'CLIENTE' | 'PERSONAL' | 'ADMIN';
export type CourtStatus = 'DISPONIBLE' | 'MANTENIMIENTO' | 'DESHABILITADA';
export type CourtType = 'GRASS_SINTETICO' | 'GRASS_NATURAL' | 'FUTBOL_5' | 'FUTBOL_7' | 'FUTBOL_11' | 'VOLEY' | 'OTRO';
export type PriceDayType = 'WEEKDAY' | 'WEEKEND' | 'HOLIDAY' | 'SPECIFIC_DAY';
export type PromotionType = 'FIXED_PRICE' | 'PERCENTAGE_DISCOUNT' | 'HAPPY_HOUR';

export type AdminUser = {
  id: number;
  fullName: string;
  email: string;
  phone?: string;
  role: Role;
  enabled: boolean;
};
export type AuthResponse = {
  token: string;
  userId: number;
  fullName: string;
  email: string;
  role: Role;
};

export type RegistrationResponse = {
  email: string;
  message: string;
  expiresInSeconds: number;
  resendAfterSeconds: number;
};

export type PasswordResetResponse = {
  message: string;
  expiresInSeconds: number;
  resendAfterSeconds: number;
};

export type Court = {
  id: number;
  name: string;
  code?: string;
  description?: string;
  mainImageUrl?: string;
  gallery?: string[];
  type: CourtType;
  dimensions?: string;
  maxPlayers: number;
  status: CourtStatus;
  hourlyPrice: number;
  halfHourPrice?: number;
  active: boolean;
  priceRules?: CourtPriceRule[];
  schedules?: CourtSchedule[];
  promotions?: CourtPromotion[];
};

export type CourtPriceRule = {
  id?: number;
  courtId?: number;
  dayType: PriceDayType;
  dayOfWeek?: string;
  startTime: string;
  endTime: string;
  hourlyPrice: number;
  halfHourPrice?: number;
  active: boolean;
};

export type CourtSchedule = {
  id?: number;
  courtId?: number;
  dayOfWeek: string;
  startTime: string;
  endTime: string;
  active: boolean;
};

export type CourtPromotion = {
  id?: number;
  courtId?: number;
  name: string;
  type: PromotionType;
  fixedPrice?: number;
  discountPercent?: number;
  requiredHours?: number;
  startTime?: string;
  endTime?: string;
  validFrom?: string;
  validTo?: string;
  active: boolean;
};

export type CourtStats = {
  courtId: number;
  courtName: string;
  totalReservations: number;
  confirmedReservations: number;
  cancelledReservations: number;
  projectedIncome: number;
};

export type Client = {
  id: number;
  userId: number;
  fullName: string;
  email: string;
  phone?: string;
  documentNumber?: string;
  address?: string;
};

export type Reservation = {
  id: number;
  clientId?: number;
  clientName: string;
  contactPhone?: string;
  guestPhone?: string;
  courtId: number;
  courtName: string;
  reservationDate: string;
  startTime: string;
  endTime: string;
  status: 'PENDIENTE' | 'CONFIRMADA' | 'CANCELADA' | 'FINALIZADA';
  totalAmount: number;
  paymentStatus: 'PENDIENTE_PAGO' | 'EN_REVISION' | 'PAGO_EN_LOCAL' | 'RECHAZADO' | 'PAGADO';
  paymentExpiresAt?: string;
  paymentMethod?: string;
  paymentRejectionReason?: string;
  notes?: string;
};

export type ReservationAudit = {
  id: number;
  action: string;
  changedBy: string;
  previousReservationStatus?: Reservation['status'];
  newReservationStatus?: Reservation['status'];
  previousPaymentStatus?: Reservation['paymentStatus'];
  newPaymentStatus?: Reservation['paymentStatus'];
  reason?: string;
  changedAt: string;
};

export type CalendarSlot = {
  courtId: number;
  courtName: string;
  startTime: string;
  endTime: string;
  status: 'DISPONIBLE' | 'PENDIENTE' | 'RESERVADO' | 'MANTENIMIENTO' | 'NO_DISPONIBLE';
  reservationId?: number;
  reservationName?: string;
  reservationPhone?: string;
  reservationStartTime?: string;
  reservationEndTime?: string;
  price?: number;
};

export type ReservationQuoteItem = {
  startTime: string;
  endTime: string;
  amount: number;
};

export type ReservationQuote = {
  courtId: number;
  date: string;
  startTime: string;
  endTime: string;
  totalAmount: number;
  breakdown: ReservationQuoteItem[];
};

export type OperationsReservation = {
  id: number;
  courtId: number;
  courtName: string;
  clientName: string;
  clientPhone?: string;
  startTime: string;
  endTime: string;
  status: Reservation['status'];
  paymentStatus: Reservation['paymentStatus'];
  totalAmount: number;
};

export type CourtOperation = {
  courtId: number;
  courtName: string;
  status: 'LIBRE' | 'OCUPADA' | 'MANTENIMIENTO' | 'DESHABILITADA';
  currentReservation?: OperationsReservation;
  nextReservation?: OperationsReservation;
};

export type OperationsDashboard = {
  date: string;
  totalReservations: number;
  pendingReservations: number;
  pendingPayments: number;
  occupiedCourts: number;
  totalCourts: number;
  collectedAmount: number;
  courts: CourtOperation[];
  upcomingReservations: OperationsReservation[];
};

export type ClientCourtAvailability = {
  courtId: number;
  courtName: string;
  description?: string;
  imageUrl?: string;
  startTime: string;
  endTime: string;
  price: number;
};

export type ClientReservationSummary = {
  id: number;
  courtId: number;
  courtName: string;
  date: string;
  startTime: string;
  endTime: string;
  status: Reservation['status'];
  paymentStatus: Reservation['paymentStatus'];
  totalAmount: number;
  paymentExpiresAt?: string;
};

export type ClientDashboard = {
  date: string;
  nextAvailableSlots: ClientCourtAvailability[];
  nextReservation?: ClientReservationSummary;
};
export type PaymentConfig = {
  ownerName: string;
  yapePhoneNumber: string;
  whatsappPhoneNumber: string;
  yapeQrUrl: string;
  paymentTimeoutMinutes: number;
};
