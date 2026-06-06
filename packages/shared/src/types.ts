export enum UserRole { ADMIN = 'ADMIN', SCHEDULING = 'SCHEDULING', TECHNICIAN = 'TECHNICIAN' }
export enum AppointmentType { INSTALLATION = 'INSTALLATION', MAINTENANCE = 'MAINTENANCE' }
export enum AppointmentStatus { SCHEDULED = 'SCHEDULED', RESCHEDULED = 'RESCHEDULED', CANCELLED = 'CANCELLED', PENDING = 'PENDING' }
export enum TaskStatus { PENDING_APPROVAL = 'PENDING_APPROVAL', APPROVED = 'APPROVED', IN_PROGRESS = 'IN_PROGRESS', COMPLETED = 'COMPLETED', POSTPONED = 'POSTPONED' }
export enum MaintenanceCycle { DAILY = 'DAILY', WEEKLY = 'WEEKLY', MONTHLY = 'MONTHLY' }

export interface User { id: string; name: string; email: string; role: UserRole; createdAt: string; }
export interface Address { id: string; city: string; district: string; streetName: string; postalCode?: string; buildingNumber?: string; floorNumber?: string; apartmentNumber?: string; }
export interface Customer { id: string; name: string; mobile: string; maintenanceCycle: MaintenanceCycle; cycleFrequency: number; notes?: string; isActive: boolean; address: Address; createdById: string; createdBy?: User; createdAt: string; updatedAt: string; appointments?: Appointment[]; }
export interface Appointment { id: string; customerId: string; customer?: Customer; type: AppointmentType; scheduledDate: string; scheduledTime: string; status: AppointmentStatus; notes?: string; createdById: string; createdBy?: User; createdAt: string; updatedAt: string; task?: MaintenanceTask; }
export interface MaintenanceTask { id: string; appointmentId: string; appointment?: Appointment; assignedToId?: string; assignedTo?: User; status: TaskStatus; completedAt?: string; notes?: string; createdAt: string; updatedAt: string; history?: TaskHistory[]; postponements?: PostponementRecord[]; }
export interface TaskHistory { id: string; taskId: string; changedById: string; changedBy?: User; fromStatus: TaskStatus; toStatus: TaskStatus; note?: string; createdAt: string; }
export interface PostponementRecord { id: string; taskId: string; technicianId: string; technician?: User; reason: string; postponedAt: string; }
export interface Notification { id: string; userId: string; title: string; body: string; isRead: boolean; relatedCustomerId?: string; relatedCustomer?: Customer; createdAt: string; }
export interface Message { id: string; senderId: string; sender?: User; body: string; type: string; relatedCustomerId?: string; relatedCustomer?: Customer; createdAt: string; }
export interface DashboardStats { totalCustomers: number; completedTasks: number; tasksThisMonth: number; tasksNextMonth: number; overdueTasks: number; activeCustomers: number; pendingApprovalTasks: number; }
export interface CustomerActivity { customerId: string; customerName: string; status: string; appointmentDate?: string; taskStatus?: TaskStatus; }
export interface LoginRequest { email: string; password: string; }
export interface LoginResponse { token: string; user: User; }
export interface ApiResponse<T> { success: boolean; data?: T; error?: string; }
export interface PaginatedResponse<T> { items: T[]; total: number; page: number; pageSize: number; totalPages: number; }
