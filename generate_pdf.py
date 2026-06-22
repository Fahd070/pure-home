"""
Pure Home - Arabic Technical Plan PDF Generator
Uses: reportlab, arabic_reshaper, python-bidi
"""

import arabic_reshaper
from bidi.algorithm import get_display
from xml.sax.saxutils import escape as xml_escape
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import cm, mm
from reportlab.lib import colors
from reportlab.lib.enums import TA_RIGHT, TA_CENTER, TA_LEFT
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    HRFlowable, PageBreak, KeepTogether
)
from reportlab.platypus.flowables import HRFlowable
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.styles import ParagraphStyle
from reportlab.graphics.shapes import Drawing, Rect, String
from reportlab.graphics import renderPDF

# ── Fonts ─────────────────────────────────────────────────────────────────────
pdfmetrics.registerFont(TTFont('Arabic', r'C:\Windows\Fonts\arial.ttf'))
pdfmetrics.registerFont(TTFont('Arabic-Bold', r'C:\Windows\Fonts\arialbd.ttf'))

# ── Helpers ───────────────────────────────────────────────────────────────────
def ar(text):
    """Reshape + bidi-reorder Arabic string for ReportLab."""
    reshaped = arabic_reshaper.reshape(text)
    return get_display(reshaped)

def ar_para(text, style):
    return Paragraph(xml_escape(ar(text)), style)

# ── Colour palette ────────────────────────────────────────────────────────────
DARK_NAVY   = colors.HexColor('#0F1B2D')
ACCENT_BLUE = colors.HexColor('#1E6FFF')
LIGHT_BLUE  = colors.HexColor('#E8F0FE')
MID_GREY    = colors.HexColor('#6B7280')
LIGHT_GREY  = colors.HexColor('#F3F4F6')
WHITE       = colors.white
BORDER      = colors.HexColor('#D1D5DB')
SECTION_BG  = colors.HexColor('#EFF6FF')
GREEN       = colors.HexColor('#059669')
ORANGE      = colors.HexColor('#D97706')

PAGE_W, PAGE_H = A4
MARGIN = 2.0 * cm

# ── Styles ────────────────────────────────────────────────────────────────────
def make_styles():
    base = dict(fontName='Arabic', leading=20, wordWrap='RTL')
    bold = dict(fontName='Arabic-Bold', leading=20, wordWrap='RTL')

    cover_title = ParagraphStyle(
        'CoverTitle', fontSize=34, textColor=WHITE,
        alignment=TA_CENTER, spaceAfter=8, leading=50, **{k:v for k,v in bold.items() if k!='leading'})

    cover_sub = ParagraphStyle(
        'CoverSub', fontSize=18, textColor=colors.HexColor('#93C5FD'),
        alignment=TA_CENTER, spaceAfter=6, leading=30, **{k:v for k,v in base.items() if k!='leading'})

    cover_author = ParagraphStyle(
        'CoverAuthor', fontSize=14, textColor=colors.HexColor('#CBD5E1'),
        alignment=TA_CENTER, spaceAfter=4, leading=22, **{k:v for k,v in base.items() if k!='leading'})

    h1 = ParagraphStyle(
        'H1', fontSize=20, textColor=ACCENT_BLUE,
        alignment=TA_RIGHT, spaceBefore=14, spaceAfter=6,
        borderPad=4, **{k:v for k,v in bold.items() if k!='leading'})

    h2 = ParagraphStyle(
        'H2', fontSize=15, textColor=DARK_NAVY,
        alignment=TA_RIGHT, spaceBefore=10, spaceAfter=4,
        **{k:v for k,v in bold.items() if k!='leading'})

    h3 = ParagraphStyle(
        'H3', fontSize=12, textColor=colors.HexColor('#1E40AF'),
        alignment=TA_RIGHT, spaceBefore=6, spaceAfter=3,
        **{k:v for k,v in bold.items() if k!='leading'})

    body = ParagraphStyle(
        'Body', fontSize=11, textColor=colors.HexColor('#1F2937'),
        alignment=TA_RIGHT, spaceAfter=5, leading=22,
        **{k:v for k,v in base.items() if k not in ('leading',)})

    bullet = ParagraphStyle(
        'Bullet', fontSize=11, textColor=colors.HexColor('#374151'),
        alignment=TA_RIGHT, spaceAfter=3, leading=20,
        rightIndent=12, **{k:v for k,v in base.items() if k not in ('leading',)})

    note = ParagraphStyle(
        'Note', fontSize=10, textColor=MID_GREY,
        alignment=TA_RIGHT, spaceAfter=3, leading=18,
        **{k:v for k,v in base.items() if k not in ('leading',)})

    table_hdr = ParagraphStyle(
        'TableHdr', fontSize=11, textColor=WHITE,
        alignment=TA_CENTER, leading=18,
        **{k:v for k,v in bold.items() if k!='leading'})

    table_cell = ParagraphStyle(
        'TableCell', fontSize=10, textColor=DARK_NAVY,
        alignment=TA_RIGHT, leading=16,
        **{k:v for k,v in base.items() if k!='leading'})

    footer = ParagraphStyle(
        'Footer', fontSize=9, textColor=MID_GREY,
        alignment=TA_CENTER, leading=14,
        **{k:v for k,v in base.items() if k!='leading'})

    return {
        'cover_title': cover_title, 'cover_sub': cover_sub,
        'cover_author': cover_author, 'h1': h1, 'h2': h2, 'h3': h3,
        'body': body, 'bullet': bullet, 'note': note,
        'table_hdr': table_hdr, 'table_cell': table_cell, 'footer': footer,
    }

S = make_styles()

# ── Section header helper ─────────────────────────────────────────────────────
def section_header(number, title):
    items = []
    header_text = f"{number}. {title}"
    items.append(ar_para(header_text, S['h1']))
    items.append(HRFlowable(width='100%', thickness=2, color=ACCENT_BLUE, spaceAfter=6))
    return items

def sub_header(title):
    return [ar_para(f"◆ {title}", S['h2'])]

def bullet_item(text):
    return ar_para(f"• {text}", S['bullet'])

def info_table(rows, col_widths=None):
    """Two-column table: label (right) | value (left)."""
    usable = PAGE_W - 2 * MARGIN
    if col_widths is None:
        col_widths = [usable * 0.38, usable * 0.62]
    data = []
    for label, value in rows:
        data.append([
            Paragraph(ar(value), S['table_cell']),
            Paragraph(ar(label), ParagraphStyle('LBold', parent=S['table_cell'],
                fontName='Arabic-Bold', textColor=DARK_NAVY)),
        ])
    t = Table(data, colWidths=col_widths)
    t.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), SECTION_BG),
        ('ROWBACKGROUNDS', (0, 0), (-1, -1), [WHITE, LIGHT_GREY]),
        ('GRID', (0, 0), (-1, -1), 0.5, BORDER),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('TOPPADDING', (0, 0), (-1, -1), 7),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 7),
        ('LEFTPADDING', (0, 0), (-1, -1), 10),
        ('RIGHTPADDING', (0, 0), (-1, -1), 10),
    ]))
    return t

# ── Cover page ────────────────────────────────────────────────────────────────
def build_cover():
    usable_w = PAGE_W - 2 * MARGIN

    # Dark background rectangle via Drawing
    d = Drawing(usable_w, 200)
    d.add(Rect(0, 0, usable_w, 200, fillColor=DARK_NAVY, strokeColor=None))
    d.add(Rect(0, 0, usable_w, 6, fillColor=ACCENT_BLUE, strokeColor=None))
    d.add(Rect(0, 194, usable_w, 6, fillColor=ACCENT_BLUE, strokeColor=None))

    items = [
        Spacer(1, 1.0 * cm),
        d,
    ]

    # Title block over dark background — use coloured paragraphs
    title_style = ParagraphStyle('CovT2', parent=S['cover_title'],
        backColor=DARK_NAVY, borderPad=10)
    sub_style   = ParagraphStyle('CovS2', parent=S['cover_sub'],
        backColor=DARK_NAVY, borderPad=4)
    auth_style  = ParagraphStyle('CovA2', parent=S['cover_author'],
        backColor=DARK_NAVY, borderPad=4)

    items += [
        Spacer(1, 0.3 * cm),
        ar_para("Pure Home", title_style),
        ar_para("نظام إدارة العمليات والخدمات", sub_style),
        Spacer(1, 0.6 * cm),
        ar_para("الخطة التقنية والتشغيلية الشاملة", ParagraphStyle(
            'CovDesc', parent=S['cover_author'],
            backColor=DARK_NAVY, fontSize=13, textColor=WHITE)),
        Spacer(1, 0.5 * cm),
        ar_para("إعداد المهندس: فهد الكثيري", auth_style),
        Spacer(1, 0.4 * cm),
        ar_para("2026", auth_style),
        Spacer(1, 1.5 * cm),
        HRFlowable(width='100%', thickness=1.5, color=ACCENT_BLUE, spaceAfter=10),
        ar_para("وثيقة سرية — للاستخدام الداخلي والعرض التقني", S['note']),
        PageBreak(),
    ]
    return items

# ── Table of contents ─────────────────────────────────────────────────────────
def build_toc():
    items = []
    items += section_header("", "فهرس المحتويات")
    toc_entries = [
        ("١", "نظرة تنفيذية عامة"),
        ("٢", "معمارية النظام"),
        ("٣", "الوحدات الأساسية"),
        ("٤", "تصميم قاعدة البيانات"),
        ("٥", "منظومة الأمن والحماية"),
        ("٦", "خطة النشر والتشغيل"),
        ("٧", "استراتيجية النسخ الاحتياطي"),
        ("٨", "إرشادات تصميم الواجهة"),
        ("٩", "مراحل التطوير"),
        ("١٠", "الخلاصة والتوصيات"),
    ]
    for num, title in toc_entries:
        row_text = f"{title}  ·  القسم {num}"
        items.append(ar_para(row_text, S['body']))
        items.append(HRFlowable(width='100%', thickness=0.5, color=BORDER, spaceAfter=4))
    items.append(PageBreak())
    return items

# ── Section 1: Executive Overview ─────────────────────────────────────────────
def build_section1():
    items = []
    items += section_header("١", "نظرة تنفيذية عامة")

    items.append(ar_para(
        "Pure Home هو نظام متكامل لإدارة العمليات والخدمات الميدانية، مصمم خصيصاً "
        "لشركات الصيانة والخدمات المنزلية. يعتمد النظام على بنية SaaS حديثة تتيح "
        "إدارة الفرق الميدانية وجدولة المواعيد ومتابعة المهام بكفاءة عالية.",
        S['body']))
    items.append(Spacer(1, 0.3 * cm))

    items += sub_header("الغرض من النظام")
    for t in [
        "أتمتة عمليات جدولة الخدمات الميدانية وتوزيع المهام على الفنيين",
        "توفير لوحة تحكم مركزية للإدارة لمتابعة جميع العمليات لحظياً",
        "تمكين فريق الجدولة من إدارة المواعيد والعملاء بسهولة واحترافية",
        "منح الفنيين الميدانيين وصولاً مباشراً لقوائم مهامهم اليومية",
        "إنتاج تقارير تشغيلية دقيقة تدعم القرارات الإدارية الاستراتيجية",
    ]:
        items.append(bullet_item(t))

    items.append(Spacer(1, 0.3 * cm))
    items += sub_header("المستخدمون المستهدفون")
    rows = [
        ("الإدارة العليا", "صلاحيات كاملة: إدارة المستخدمين، الأكواد، التقارير، سجل الأحداث"),
        ("فريق الجدولة",   "إدارة العملاء، المواعيد، توزيع المهام، والإشعارات"),
        ("الفنيون الميدانيون", "استقبال المهام، تحديث حالتها، وعرض التعليمات"),
    ]
    items.append(info_table(rows))
    items.append(Spacer(1, 0.4 * cm))

    items += sub_header("القيمة التنافسية")
    for t in [
        "واجهة مستخدم عربية بالكامل مع دعم RTL أصلي",
        "نشر فوري على السحابة دون الحاجة إلى بنية تحتية محلية معقدة",
        "تكامل الوقت الفعلي عبر Socket.IO لإشعارات فورية بدون تأخير",
        "بنية متعددة الأدوار مع تحكم دقيق في الصلاحيات",
        "تطبيق سطح مكتب محلي يعمل دون الاعتماد الكامل على المتصفح",
    ]:
        items.append(bullet_item(t))

    items.append(PageBreak())
    return items

# ── Section 2: System Architecture ────────────────────────────────────────────
def build_section2():
    items = []
    items += section_header("٢", "معمارية النظام")

    items.append(ar_para(
        "يعتمد النظام على معمارية متعددة الطبقات (Multi-Tier Architecture) تفصل "
        "بوضوح بين طبقة العرض وطبقة الأعمال وطبقة البيانات، مما يضمن قابلية "
        "التوسع والصيانة على المدى البعيد.",
        S['body']))
    items.append(Spacer(1, 0.3 * cm))

    layers = [
        ("طبقة العرض (Frontend)",      "Electron + React + Vite + TanStack Query + Zustand"),
        ("طبقة الأعمال (Backend)",      "Node.js + Express + Prisma ORM"),
        ("الاتصال الفوري",              "Socket.IO — WebSocket مع JWT Authentication"),
        ("قاعدة البيانات",             "PostgreSQL عبر Supabase (منصة إدارة مُدارة)"),
        ("المصادقة",                   "JWT (JSON Web Tokens) — انتهاء صلاحية 7 أيام"),
        ("الاستضافة",                  "Render.com — خادم Cloud ويب مُدار"),
        ("CI/CD",                     "GitHub Actions — نشر تلقائي عند الدفع إلى main"),
        ("إدارة الحزم",                "npm Workspaces — Monorepo بحزمتين"),
    ]

    items += sub_header("مكونات المعمارية")
    items.append(info_table(layers))
    items.append(Spacer(1, 0.4 * cm))

    items += sub_header("مخطط تدفق البيانات")
    flow = [
        "١. يفتح المستخدم تطبيق Electron على جهازه",
        "٢. يُرسل طلب HTTP/HTTPS إلى خادم Express على Render",
        "٣. يتحقق Middleware من صحة JWT قبل الوصول إلى أي مسار محمي",
        "٤. يتواصل Prisma مع قاعدة بيانات PostgreSQL على Supabase",
        "٥. تُعاد النتيجة للعميل عبر JSON",
        "٦. تُرسل الأحداث الفورية (الإشعارات، المهام) عبر Socket.IO",
    ]
    for line in flow:
        items.append(ar_para(line, S['body']))

    items.append(Spacer(1, 0.4 * cm))
    items += sub_header("مزايا المعمارية المختارة")
    for t in [
        "فصل كامل بين المنطق والعرض يسهّل الاختبار والصيانة",
        "Monorepo يجمع Frontend وBackend في مستودع واحد مع مشاركة الأنواع",
        "Prisma يوفر نمذجة بيانات آمنة بالأنواع ومهاجرات منظمة",
        "Socket.IO يدعم الانسحاب التلقائي وإعادة الاتصال دون تدخل المطور",
    ]:
        items.append(bullet_item(t))

    items.append(PageBreak())
    return items

# ── Section 3: Core Modules ────────────────────────────────────────────────────
def build_section3():
    items = []
    items += section_header("٣", "الوحدات الأساسية للنظام")

    modules = [
        ("إدارة العملاء",
         "تسجيل بيانات العملاء الكاملة، متابعة حالة الموافقة، البحث والتصفية، "
         "وربط كل عميل بمواعيده وسجل خدماته. تشمل آلية موافقة ثنائية المرحلة "
         "من الإدارة قبل تفعيل أي عميل جديد."),

        ("إدارة المواعيد",
         "جدولة مواعيد الصيانة مع دعم التكرار الدوري، تعيين الفنيين، "
         "إدارة حالات الموعد (مجدول / مكتمل / ملغي)، والتكامل الفوري مع "
         "لوحة تحكم الفنيين عبر Socket.IO."),

        ("إدارة الفنيين",
         "ملفات الفنيين الكاملة، تتبع حالة التوفر، قوائم المهام اليومية، "
         "وإحصائيات الأداء. يُمكّن مدير الجدولة من توزيع المهام آلياً "
         "بناءً على التوفر والموقع."),

        ("نظام المهام",
         "إنشاء المهام وتعيينها وتتبع حالتها (معلقة / قيد التنفيذ / مكتملة). "
         "يستقبل الفنيون مهامهم فوراً عبر Socket.IO مع دعم الملاحظات والمرفقات."),

        ("الإشعارات الفورية",
         "نظام إشعارات ثنائي الاتجاه يعتمد Socket.IO. تصل الإشعارات لحظياً "
         "لجميع المستخدمين المعنيين مع دعم الإشعارات المجدولة من خادم cron "
         "وآلية منع التكرار (dedup key)."),

        ("لوحة التحكم",
         "نظرة شاملة على مؤشرات الأداء الرئيسية: عدد العملاء، المواعيد اليومية، "
         "المهام المعلقة، نشاط الفنيين. تتحدث البيانات لحظياً دون تحديث الصفحة."),

        ("نظام التقارير",
         "توليد تقارير PDF احترافية لأداء الفنيين، ملخصات العملاء، "
         "وإحصائيات المواعيد. تعمل التقارير في نافذة Electron مستقلة "
         "مع دعم الطباعة المباشرة."),

        ("سجل الأحداث — Audit Logs",
         "تسجيل شامل لكل الإجراءات الحساسة: من قام بها، متى، وماذا غيّر. "
         "لا يمكن حذف السجلات إلا من قِبل المدير الأعلى. يوفر مساراً "
         "كاملاً للمراجعة والامتثال التنظيمي."),
    ]

    for i, (title, desc) in enumerate(modules):
        bg = SECTION_BG if i % 2 == 0 else WHITE
        block = Table([[
            Paragraph(ar(desc), S['body']),
            Paragraph(ar(f"◈  {title}"), ParagraphStyle(
                'ModTitle', parent=S['h3'], spaceAfter=0)),
        ]], colWidths=[PAGE_W - 2*MARGIN - 4.5*cm, 4.5*cm])
        block.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, -1), bg),
            ('BOX', (0, 0), (-1, -1), 1, BORDER),
            ('VALIGN', (0, 0), (-1, -1), 'TOP'),
            ('TOPPADDING', (0, 0), (-1, -1), 10),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 10),
            ('LEFTPADDING', (0, 0), (-1, -1), 10),
            ('RIGHTPADDING', (0, 0), (-1, -1), 10),
        ]))
        items.append(block)
        items.append(Spacer(1, 0.25 * cm))

    items.append(PageBreak())
    return items

# ── Section 4: Database Design ─────────────────────────────────────────────────
def build_section4():
    items = []
    items += section_header("٤", "تصميم قاعدة البيانات")

    items.append(ar_para(
        "تستخدم قاعدة البيانات نموذج العلاقات (Relational Model) مع PostgreSQL. "
        "جميع الجداول لها مفاتيح UUID كمعرفات أساسية لضمان التوافق الموزع وتجنب "
        "التصادمات عند الدمج.",
        S['body']))
    items.append(Spacer(1, 0.3 * cm))

    tables = [
        ("users",
         "يخزن معلومات المستخدمين: الدور (ADMIN/SCHEDULING/TECHNICIAN)، "
         "الاسم، بيانات الجلسة. يُستخدم في التحقق من الهوية وتطبيق الصلاحيات."),

        ("customers",
         "بيانات العملاء: الاسم، رقم الجوال، العنوان، حالة الموافقة، "
         "تاريخ الإنشاء. يرتبط بجدول appointments برابط one-to-many."),

        ("appointments",
         "سجل المواعيد: تاريخ الموعد، الوقت، الحالة، الفني المسؤول، "
         "والعميل المرتبط. يربط customers و users (الفنيين) في علاقة مختلطة."),

        ("maintenance_tasks",
         "المهام الفردية داخل كل موعد: الوصف، الحالة، الفني المكلف، "
         "الملاحظات، وتوقيت الإنجاز. ترتبط بـ appointments برابط many-to-one."),

        ("audit_logs",
         "سجل لا يمكن حذفه بواسطة المستخدمين العاديين: الإجراء، الجدول المتأثر، "
         "معرف المستخدم المنفذ، الطابع الزمني بتوقيت UTC."),

        ("event_logs / notifications",
         "قائمة الإشعارات: النص، المستلم، حالة القراءة، نوع الحدث، "
         "مفتاح منع التكرار (dedup_key)، ووقت الإنشاء."),

        ("system_configs",
         "إعدادات النظام القابلة للتعديل عبر الواجهة: أكواد الدخول لكل دور، "
         "إعدادات الإشعارات المجدولة. مخزنة كأزواج key/value."),
    ]

    for tname, tdesc in tables:
        items += sub_header(f"جدول: {tname}")
        items.append(ar_para(tdesc, S['body']))
        items.append(Spacer(1, 0.15 * cm))

    items.append(Spacer(1, 0.3 * cm))
    items += sub_header("العلاقات بين الجداول")
    relations = [
        "customers  ←→  appointments   :  عميل واحد — مواعيد متعددة (1:N)",
        "appointments ←→ maintenance_tasks : موعد واحد — مهام متعددة (1:N)",
        "users ←→ appointments         :  فني واحد — مواعيد متعددة (1:N)",
        "users ←→ audit_logs           :  مستخدم واحد — سجلات متعددة (1:N)",
        "users ←→ notifications        :  مستخدم واحد — إشعارات متعددة (1:N)",
    ]
    for r in relations:
        items.append(ar_para(r, S['bullet']))

    items.append(PageBreak())
    return items

# ── Section 5: Security ────────────────────────────────────────────────────────
def build_section5():
    items = []
    items += section_header("٥", "منظومة الأمن والحماية")

    items += sub_header("التحكم في الوصول بناءً على الأدوار (RBAC)")
    items.append(ar_para(
        "كل مسار API محمي بـ Middleware يتحقق من دور المستخدم قبل السماح بالتنفيذ. "
        "لا يوجد أي مسار حساس يعمل بدون JWT صالح.",
        S['body']))

    perms = [
        ("ADMIN",       "كامل الصلاحيات — إدارة المستخدمين والأكواد والتقارير وسجل الأحداث"),
        ("SCHEDULING",  "إدارة العملاء والمواعيد والمهام — لا يمكن حذف سجل الأحداث"),
        ("TECHNICIAN",  "قراءة المهام المسندة وتحديث حالتها فقط"),
    ]
    items.append(info_table(perms))
    items.append(Spacer(1, 0.4 * cm))

    items += sub_header("تدفق المصادقة")
    auth_steps = [
        "١. يدخل المستخدم كود الوصول الخاص بدوره",
        "٢. يتحقق الخادم من الكود مقارنةً بقاعدة البيانات أو متغير البيئة",
        "٣. عند النجاح: يُولَّد JWT يحمل الدور ومعرف المستخدم وتاريخ الانتهاء",
        "٤. يُخزَّن الـ JWT محلياً في Electron Store المشفر",
        "٥. يُرسَل مع كل طلب HTTP في ترويسة Authorization: Bearer <token>",
        "٦. يُستخدم أيضاً في مصادقة Socket.IO عبر socket.handshake.auth.token",
    ]
    for step in auth_steps:
        items.append(ar_para(step, S['body']))

    items.append(Spacer(1, 0.4 * cm))
    items += sub_header("إجراءات حماية البيانات")
    security_measures = [
        "جميع الأسرار (JWT_SECRET، DATABASE_URL) مخزنة فقط في GitHub Secrets وRender Environment",
        "ملفات .env مستثناة من git تماماً عبر .gitignore",
        "CORS مُقيّد بقائمة محددة من المصادر المسموح بها",
        "Helmet.js مُفعّل لإضافة ترويسات HTTP الأمنية تلقائياً",
        "rate limiting لحماية مسارات تسجيل الدخول من الهجمات التخمينية",
        "contextIsolation: true في Electron يمنع الوصول غير المصرح لـ Node.js",
        "sandbox: true لنوافذ PDF يحد من صلاحياتها بصرامة",
        "جميع الاتصالات عبر HTTPS في بيئة الإنتاج",
    ]
    for m in security_measures:
        items.append(bullet_item(m))

    items.append(PageBreak())
    return items

# ── Section 6: Deployment ──────────────────────────────────────────────────────
def build_section6():
    items = []
    items += section_header("٦", "خطة النشر والتشغيل")

    items += sub_header("سير عمل GitHub")
    git_flow = [
        ("main", "الفرع الرئيسي — أي دفع يُطلق النشر التلقائي على Render"),
        ("develop", "فرع التطوير — لدمج الميزات قبل الترقية لـ main"),
        ("feature/*", "فروع الميزات الفردية — تُدمج عبر Pull Request"),
        ("hotfix/*", "إصلاحات عاجلة تُدمج مباشرة في main مع وسم إصدار"),
    ]
    items.append(info_table(git_flow))
    items.append(Spacer(1, 0.4 * cm))

    items += sub_header("CI/CD عبر Render")
    for step in [
        "عند الدفع إلى main: Render يكتشف التغيير ويبدأ بناءً جديداً",
        "تنفيذ npm install ثم npm run build في بيئة Linux مُدارة",
        "تشغيل prisma migrate deploy لتطبيق أي مهاجرات جديدة",
        "استبدال الحاوية القديمة بالجديدة مع وقت توقف شبه صفري",
        "إعادة التشغيل التلقائي عند أي خطأ في وقت التشغيل",
    ]:
        items.append(bullet_item(step))

    items.append(Spacer(1, 0.4 * cm))
    items += sub_header("متغيرات البيئة")
    env_vars = [
        ("DATABASE_URL",    "سلسلة اتصال PostgreSQL عبر pgBouncer (المنفذ 6543)"),
        ("JWT_SECRET",      "مفتاح توقيع JWT — لا يقل عن 32 حرفاً عشوائياً"),
        ("PORT",            "رقم المنفذ (Render يُحدده تلقائياً)"),
        ("ADMIN_CODE",      "كود دخول المديرين (احتياطي إذا لم يُحدَّد في قاعدة البيانات)"),
        ("SCHEDULING_CODE", "كود دخول فريق الجدولة"),
        ("TECHNICIAN_CODE", "كود دخول الفنيين الميدانيين"),
        ("SUPABASE_DIRECT_URL", "اتصال مباشر بقاعدة البيانات (المنفذ 5432) للنسخ الاحتياطي"),
    ]
    items.append(info_table(env_vars))

    items.append(Spacer(1, 0.4 * cm))
    items += sub_header("الفرق بين بيئة التطوير والإنتاج")
    rows = [
        ("التطوير",    "خادم Vite محلي + قاعدة بيانات Supabase تجريبية + nodemon"),
        ("الإنتاج",    "Render cloud + قاعدة بيانات Supabase مُدارة + حزمة Electron مُوزَّعة"),
        ("المتغيرات",  ".env محلي في التطوير — Render Environment Variables في الإنتاج"),
    ]
    items.append(info_table(rows))

    items.append(PageBreak())
    return items

# ── Section 7: Backup ──────────────────────────────────────────────────────────
def build_section7():
    items = []
    items += section_header("٧", "استراتيجية النسخ الاحتياطي والاسترداد")

    items.append(ar_para(
        "تعتمد استراتيجية النسخ الاحتياطي على طبقتين متكاملتين: "
        "النسخ الاحتياطية المُدارة من Supabase، والنسخ الاحتياطية الآلية "
        "عبر GitHub Actions لضمان الاسترداد الكامل في أي وقت.",
        S['body']))
    items.append(Spacer(1, 0.3 * cm))

    items += sub_header("الطبقة الأولى: Supabase المُدارة")
    for t in [
        "نسخ احتياطية يومية تلقائية — محتفظ بها لمدة 7 أيام (الخطة المجانية)",
        "نسخ احتياطية لمدة 30 يوماً في الخطة المدفوعة",
        "استرداد نقطي (Point-in-Time Recovery) في خطط المؤسسات",
        "تشفير البيانات المحفوظة باستخدام AES-256",
    ]:
        items.append(bullet_item(t))

    items.append(Spacer(1, 0.3 * cm))
    items += sub_header("الطبقة الثانية: GitHub Actions الآلية")
    for t in [
        "يعمل كل يوم بشكل تلقائي عند الساعة 02:00 UTC",
        "يستخدم pg_dump مع تشفير مضغوط (--compress=9) بصيغة custom",
        "يتحقق من سلامة الملف قبل الرفع (فحص عدد العناصر >= 5)",
        "يرفع النسخة كـ GitHub Artifact محتفظاً بها 90 يوماً",
        "يُطلق تنبيهاً فورياً في حالة الفشل عبر GitHub Notifications",
        "يمكن تشغيله يدوياً في أي وقت عبر workflow_dispatch",
    ]:
        items.append(bullet_item(t))

    items.append(Spacer(1, 0.3 * cm))
    items += sub_header("خطة الاسترداد")
    recovery = [
        ("الوقت المستهدف للاسترداد (RTO)", "أقل من 30 دقيقة للاسترداد الكامل"),
        ("نقطة الاسترداد المستهدفة (RPO)", "أقصى فقدان للبيانات: 24 ساعة"),
        ("أداة الاسترداد",                 "سكريبت restore-backup.ps1 مع فحص مسبق للسلامة"),
        ("متطلبات الاسترداد",              "SUPABASE_DIRECT_URL + pg_restore + تأكيد يدوي"),
    ]
    items.append(info_table(recovery))

    items.append(PageBreak())
    return items

# ── Section 8: UI/UX ───────────────────────────────────────────────────────────
def build_section8():
    items = []
    items += section_header("٨", "إرشادات تصميم الواجهة")

    items += sub_header("مبادئ التصميم الأساسية")
    for t in [
        "بساطة مع احترافية: الواجهة نظيفة خالية من الفوضى البصرية",
        "دعم RTL كامل: جميع عناصر الواجهة مُصممة للعربية من الأساس",
        "تصميم متجاوب يعمل على شاشات مختلفة الأحجام",
        "تغذية راجعة فورية: كل إجراء يُثلث تأكيداً بصرياً",
        "لوحة تحكم أولاً: أهم المعلومات دائماً في المقدمة",
    ]:
        items.append(bullet_item(t))

    items.append(Spacer(1, 0.3 * cm))
    items += sub_header("نظام الألوان")
    colors_data = [
        ("الأزرق الداكن",  "#0F1B2D  —  خلفية الشريط الجانبي والرأس"),
        ("الأزرق الفاتح",  "#1E6FFF  —  الأزرار، الروابط، المؤشرات النشطة"),
        ("الرمادي الفاتح", "#F3F4F6  —  خلفيات البطاقات والأقسام"),
        ("الأخضر",         "#059669  —  حالات النجاح والإنجاز"),
        ("البرتقالي",       "#D97706  —  التحذيرات والحالات المعلقة"),
        ("الأحمر",          "#DC2626  —  الأخطاء وعمليات الحذف"),
    ]
    items.append(info_table(colors_data))

    items.append(Spacer(1, 0.3 * cm))
    items += sub_header("الخطوط والطباعة")
    for t in [
        "Arabic UI Font: خط عربي حديث مع وضوح كامل على الشاشات",
        "حجم النص الأساسي: 14px — مقروء دون إرهاق",
        "عناوين الأقسام: 20-24px bold",
        "نصوص الجداول: 12-13px للكثافة الصحيحة",
        "تباعد الأسطر: 1.6 للراحة البصرية",
    ]:
        items.append(bullet_item(t))

    items.append(Spacer(1, 0.3 * cm))
    items += sub_header("دعم الوضع الداكن والفاتح")
    items.append(ar_para(
        "يدعم النظام وضعَي العرض الداكن والفاتح مع التحويل الفوري بدون إعادة "
        "تحميل. يُحفظ تفضيل المستخدم في localStorage ويُستعاد عند كل تشغيل. "
        "جميع الألوان مُعرَّفة كمتغيرات CSS للتحويل السلس.",
        S['body']))

    items.append(PageBreak())
    return items

# ── Section 9: Development Phases ─────────────────────────────────────────────
def build_section9():
    items = []
    items += section_header("٩", "مراحل التطوير")

    phases = [
        ("المرحلة الأولى", "إعداد البنية التحتية الأساسية",
         ["إنشاء المستودع وهيكل Monorepo",
          "إعداد قاعدة بيانات Supabase وتعريف مخطط Prisma",
          "تطوير خادم Express مع مسارات المصادقة",
          "نشر الخادم على Render والتحقق من /health",
          "إعداد GitHub Actions للنشر التلقائي"]),

        ("المرحلة الثانية", "تطوير الواجهة الأمامية",
         ["إعداد مشروع Electron + Vite + React",
          "تطوير نظام التوجيه وإدارة الحالة (Zustand + TanStack Query)",
          "بناء وحدة إدارة العملاء والمواعيد",
          "تطوير لوحة التحكم مع البيانات الإحصائية",
          "تنفيذ واجهة الفنيين وقائمة المهام"]),

        ("المرحلة الثالثة", "نظام الوقت الفعلي",
         ["تكامل Socket.IO في الخادم مع JWT Auth",
          "توصيل الإشعارات الفورية للعميل",
          "تطوير نظام cron للإشعارات المجدولة",
          "اختبار الاتصال الفوري عبر سيناريوهات متعددة"]),

        ("المرحلة الرابعة", "الاختبار والتحسين",
         ["اختبار وحدات API (Unit Tests)",
          "اختبار تكاملي للتدفقات الأساسية",
          "تحسين أداء الاستعلامات وإضافة الفهارس",
          "مراجعة أمنية شاملة (OWASP checklist)",
          "توثيق API والكود المصدري"]),

        ("المرحلة الخامسة", "النشر والإطلاق",
         ["بناء حزمة Electron وتوليد المثبّت",
          "اختبار التثبيت على أجهزة Windows مختلفة",
          "إعداد إصدار GitHub مع ملاحظات التغيير",
          "تدريب المستخدمين وتسليم التوثيق",
          "المراقبة المستمرة بعد الإطلاق"])
    ]

    for phase_num, phase_title, tasks in phases:
        items += sub_header(f"{phase_num}: {phase_title}")
        for task in tasks:
            items.append(bullet_item(task))
        items.append(Spacer(1, 0.2 * cm))

    items.append(PageBreak())
    return items

# ── Section 10: Summary ────────────────────────────────────────────────────────
def build_section10():
    items = []
    items += section_header("١٠", "الخلاصة والتوصيات")

    items.append(ar_para(
        "Pure Home يمثل حلاً متكاملاً ومتكيفاً لإدارة العمليات الميدانية، "
        "مبنياً على أحدث التقنيات وبمعمارية قابلة للتوسع تخدم الشركات الصغيرة "
        "والمتوسطة والكبيرة على حدٍّ سواء.",
        S['body']))
    items.append(Spacer(1, 0.3 * cm))

    items += sub_header("القيم الجوهرية المُحققة")
    for t in [
        "كفاءة تشغيلية: تقليل وقت جدولة الموعد من دقائق إلى ثوانٍ",
        "شفافية كاملة: كل إجراء مُسجَّل في سجل الأحداث",
        "موثوقية: نسخ احتياطية آلية يومية وخطة استرداد واضحة",
        "أمان متعدد الطبقات: JWT + RBAC + HTTPS + Helmet.js",
        "تجربة مستخدم عربية أصيلة: RTL + خطوط محلية + تصميم ثقافي ملائم",
    ]:
        items.append(bullet_item(t))

    items.append(Spacer(1, 0.3 * cm))
    items += sub_header("خيارات التوسع المستقبلي")
    future = [
        ("تطبيق الجوال",       "React Native للفنيين الميدانيين مع دعم إشعارات Push"),
        ("الذكاء الاصطناعي",   "توزيع تلقائي للمهام بناءً على موقع الفني وجدوله"),
        ("التكامل مع ERP",     "ربط مع أنظمة المحاسبة والمخزون"),
        ("بوابة العملاء",      "بوابة ذاتية للعملاء لمتابعة طلباتهم وتقييم الخدمة"),
        ("التقارير المتقدمة",  "لوحات Power BI أو Metabase للتحليلات العميقة"),
    ]
    items.append(info_table(future))

    items.append(Spacer(1, 0.8 * cm))
    items.append(HRFlowable(width='100%', thickness=2, color=ACCENT_BLUE, spaceAfter=16))

    sig_style = ParagraphStyle('Sig', parent=S['body'],
        alignment=TA_CENTER, fontSize=13, textColor=DARK_NAVY,
        fontName='Arabic-Bold', leading=26)
    note_style = ParagraphStyle('SigNote', parent=S['note'], alignment=TA_CENTER)

    items.append(ar_para("إعداد المهندس", note_style))
    items.append(ar_para("فهد الكثيري", sig_style))
    items.append(ar_para("Pure Home — نظام إدارة العمليات والخدمات", note_style))
    items.append(ar_para("2026", note_style))

    return items

# ── Page template (header + footer) ───────────────────────────────────────────
def on_page(canvas, doc):
    canvas.saveState()
    w, h = A4

    # Header bar
    canvas.setFillColor(DARK_NAVY)
    canvas.rect(0, h - 1.2*cm, w, 1.2*cm, fill=1, stroke=0)
    canvas.setFillColor(ACCENT_BLUE)
    canvas.rect(0, h - 1.2*cm, w, 0.18*cm, fill=1, stroke=0)

    # Header text
    reshaped_hdr = arabic_reshaper.reshape("Pure Home — الخطة التقنية الشاملة")
    bidi_hdr = get_display(reshaped_hdr)
    canvas.setFont('Arabic', 9)
    canvas.setFillColor(colors.HexColor('#CBD5E1'))
    canvas.drawString(MARGIN, h - 0.82*cm, bidi_hdr)

    # Footer
    canvas.setFillColor(LIGHT_GREY)
    canvas.rect(0, 0, w, 1.0*cm, fill=1, stroke=0)
    canvas.setFillColor(ACCENT_BLUE)
    canvas.rect(0, 1.0*cm, w, 0.12*cm, fill=1, stroke=0)

    reshaped_ftr = arabic_reshaper.reshape("إعداد المهندس: فهد الكثيري  |  Pure Home")
    bidi_ftr = get_display(reshaped_ftr)
    canvas.setFont('Arabic', 8)
    canvas.setFillColor(MID_GREY)
    canvas.drawString(MARGIN, 0.35*cm, bidi_ftr)

    page_num = arabic_reshaper.reshape(f"صفحة {doc.page}")
    page_bidi = get_display(page_num)
    canvas.drawRightString(w - MARGIN, 0.35*cm, page_bidi)

    canvas.restoreState()

# ── Main ───────────────────────────────────────────────────────────────────────
def build_pdf(output_path):
    doc = SimpleDocTemplate(
        output_path,
        pagesize=A4,
        rightMargin=MARGIN,
        leftMargin=MARGIN,
        topMargin=1.6*cm,
        bottomMargin=1.4*cm,
        title="Pure Home — الخطة التقنية الشاملة",
        author="فهد الكثيري",
        subject="نظام إدارة العمليات والخدمات",
    )

    story = []
    story += build_cover()
    story += build_toc()
    story += build_section1()
    story += build_section2()
    story += build_section3()
    story += build_section4()
    story += build_section5()
    story += build_section6()
    story += build_section7()
    story += build_section8()
    story += build_section9()
    story += build_section10()

    doc.build(story, onFirstPage=on_page, onLaterPages=on_page)
    print(f"PDF generated: {output_path}")

if __name__ == '__main__':
    import os
    out = os.path.join(os.path.dirname(__file__), 'Pure-Home-Technical-Plan.pdf')
    build_pdf(out)
