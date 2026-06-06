import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

const ar = {
  common: {
    save: 'حفظ', cancel: 'إلغاء', delete: 'حذف', edit: 'تعديل', search: 'بحث',
    loading: 'جاري التحميل...', error: 'حدث خطأ', success: 'تم بنجاح',
    yes: 'نعم', no: 'لا', close: 'إغلاق', back: 'رجوع', next: 'التالي',
    add: 'إضافة', view: 'عرض', name: 'الاسم', phone: 'الجوال', notes: 'ملاحظات',
    status: 'الحالة', date: 'التاريخ', actions: 'الإجراءات', total: 'الإجمالي',
    active: 'نشط', inactive: 'غير نشط', all: 'الكل',
  },
  auth: {
    login: 'تسجيل الدخول', logout: 'تسجيل الخروج',
    email: 'البريد الإلكتروني', password: 'كلمة المرور',
    invalidCredentials: 'بيانات الدخول غير صحيحة', serverUrl: 'عنوان الخادم',
    serverSetup: 'إعداد الخادم', connect: 'اتصال', appName: 'نظام صيانة فلاتر المياه',
  },
  nav: {
    dashboard: 'لوحة التحكم', customers: 'العملاء', appointments: 'المواعيد',
    tasks: 'المهام', technicians: 'الفنيون', messages: 'الرسائل',
    notifications: 'الإشعارات', settings: 'الإعدادات', workQueue: 'قائمة العمل',
  },
  customers: {
    title: 'العملاء', add: 'إضافة عميل', edit: 'تعديل العميل',
    maintenanceCycle: 'دورة الصيانة', daily: 'يومي', weekly: 'أسبوعي', monthly: 'شهري',
    frequency: 'التكرار', city: 'المدينة', district: 'الحي', street: 'الشارع',
    postalCode: 'الرمز البريدي', buildingNo: 'رقم المبنى', floorNo: 'رقم الطابق',
    apartmentNo: 'رقم الشقة', address: 'العنوان', phoneInvalid: 'رقم الجوال يجب أن يبدأ بـ 05 ويتكون من 10 أرقام',
    toggleActive: 'تبديل الحالة',
  },
  appointments: {
    title: 'المواعيد', new: 'موعد جديد', type: 'النوع',
    installation: 'تركيب', maintenance: 'صيانة',
    scheduled: 'مجدول', rescheduled: 'معاد جدولته', cancelled: 'ملغي', pending: 'قيد الانتظار',
    customer: 'العميل', technician: 'الفني', selectCustomer: 'اختر عميل',
  },
  tasks: {
    title: 'المهام', approve: 'موافقة', reject: 'رفض', start: 'بدء', complete: 'إتمام',
    postpone: 'تأجيل', reason: 'السبب', newDate: 'التاريخ الجديد',
    pendingApproval: 'بانتظار الموافقة', approved: 'تمت الموافقة',
    inProgress: 'قيد التنفيذ', completed: 'مكتملة', postponed: 'مؤجلة',
    selectTechnician: 'اختر فني', confirmComplete: 'تأكيد إتمام المهمة',
    confirmPostpone: 'تأكيد تأجيل المهمة',
  },
  technicians: { title: 'الفنيون', completedTasks: 'المهام المكتملة', pendingTasks: 'المهام المعلقة' },
  messages: { title: 'الرسائل', placeholder: 'اكتب رسالة...', send: 'إرسال' },
  notifications: { title: 'الإشعارات', markAllRead: 'تعيين الكل كمقروء', noNotifications: 'لا توجد إشعارات' },
  dashboard: {
    title: 'لوحة التحكم', totalTasks: 'إجمالي المهام', completedTasks: 'المهام المكتملة',
    thisMonth: 'هذا الشهر', nextMonth: 'الشهر القادم', pendingTasks: 'المهام المعلقة',
    activeCustomers: 'العملاء النشطون', pendingApproval: 'بانتظار الموافقة',
    recentActivity: 'النشاط الأخير',
  },
};

const en: typeof ar = {
  common: {
    save: 'Save', cancel: 'Cancel', delete: 'Delete', edit: 'Edit', search: 'Search',
    loading: 'Loading...', error: 'An error occurred', success: 'Success',
    yes: 'Yes', no: 'No', close: 'Close', back: 'Back', next: 'Next',
    add: 'Add', view: 'View', name: 'Name', phone: 'Phone', notes: 'Notes',
    status: 'Status', date: 'Date', actions: 'Actions', total: 'Total',
    active: 'Active', inactive: 'Inactive', all: 'All',
  },
  auth: {
    login: 'Login', logout: 'Logout', email: 'Email', password: 'Password',
    invalidCredentials: 'Invalid credentials', serverUrl: 'Server URL',
    serverSetup: 'Server Setup', connect: 'Connect', appName: 'Water Filter Maintenance System',
  },
  nav: {
    dashboard: 'Dashboard', customers: 'Customers', appointments: 'Appointments',
    tasks: 'Tasks', technicians: 'Technicians', messages: 'Messages',
    notifications: 'Notifications', settings: 'Settings', workQueue: 'Work Queue',
  },
  customers: {
    title: 'Customers', add: 'Add Customer', edit: 'Edit Customer',
    maintenanceCycle: 'Maintenance Cycle', daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly',
    frequency: 'Frequency', city: 'City', district: 'District', street: 'Street',
    postalCode: 'Postal Code', buildingNo: 'Building No', floorNo: 'Floor No',
    apartmentNo: 'Apartment No', address: 'Address', phoneInvalid: 'Phone must start with 05 and be 10 digits',
    toggleActive: 'Toggle Status',
  },
  appointments: {
    title: 'Appointments', new: 'New Appointment', type: 'Type',
    installation: 'Installation', maintenance: 'Maintenance',
    scheduled: 'Scheduled', rescheduled: 'Rescheduled', cancelled: 'Cancelled', pending: 'Pending',
    customer: 'Customer', technician: 'Technician', selectCustomer: 'Select Customer',
  },
  tasks: {
    title: 'Tasks', approve: 'Approve', reject: 'Reject', start: 'Start', complete: 'Complete',
    postpone: 'Postpone', reason: 'Reason', newDate: 'New Date',
    pendingApproval: 'Pending Approval', approved: 'Approved',
    inProgress: 'In Progress', completed: 'Completed', postponed: 'Postponed',
    selectTechnician: 'Select Technician', confirmComplete: 'Confirm Complete Task',
    confirmPostpone: 'Confirm Postpone Task',
  },
  technicians: { title: 'Technicians', completedTasks: 'Completed Tasks', pendingTasks: 'Pending Tasks' },
  messages: { title: 'Messages', placeholder: 'Type a message...', send: 'Send' },
  notifications: { title: 'Notifications', markAllRead: 'Mark All Read', noNotifications: 'No notifications' },
  dashboard: {
    title: 'Dashboard', totalTasks: 'Total Tasks', completedTasks: 'Completed Tasks',
    thisMonth: 'This Month', nextMonth: 'Next Month', pendingTasks: 'Pending Tasks',
    activeCustomers: 'Active Customers', pendingApproval: 'Pending Approval',
    recentActivity: 'Recent Activity',
  },
};

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: { ar: { translation: ar }, en: { translation: en } },
    fallbackLng: 'ar', lng: 'ar',
    interpolation: { escapeValue: false },
  });

i18n.on('languageChanged', (lng) => {
  document.documentElement.dir = lng === 'ar' ? 'rtl' : 'ltr';
  document.documentElement.lang = lng;
});

export default i18n;
